import { useState, useRef, useEffect, useCallback } from 'react';

// Approx chars/sec a TTS voice utters at rate=1. Used as a fallback for voices
// that never fire `onboundary` (Microsoft "Online"/"Natural", most Google
// voices). ~150 wpm × ~6 chars/word ≈ 15.
const ESTIMATED_CHARS_PER_SECOND = 20;
// Grace period before the estimator kicks in, so voices that *do* support
// boundaries get to fire one first and suppress the estimator.
const ESTIMATOR_GRACE_MS = 250;
// Throttle the estimator — words are spoken at ~2-3/sec so 100ms is plenty.
const ESTIMATOR_TICK_MS = 100;

// Chunks (sentence-sized, the unit of display/seek/highlight) get batched into
// larger utterances at speak-time. Each utterance carries an end-of-utterance
// silence the engine inserts on its own (~150-300ms), which is the audible
// "gap" between chunks. Batching collapses N gaps into 1 — sentences inside a
// batch run together with natural prosodic punctuation pauses, not engine
// silences. 1500 is comfortable for all engines I've tested without losing
// `onboundary` accuracy on the voices that support it.
const MAX_UTTERANCE_CHARS = 1500;

// Pack chunks[startIdx..] (starting from `startCharOffset` within the first
// chunk) into one utterance up to MAX_UTTERANCE_CHARS. Returns the joined
// text plus a boundary table mapping char-positions-in-utterance back to the
// originating display chunk, so `onboundary`/the estimator can flip the UI
// to the right chunk as audio progresses through the batch.
function buildBatch(allChunks, startIdx, startCharOffset) {
  if (startIdx >= allChunks.length) return null;
  const firstSegment = allChunks[startIdx].slice(startCharOffset);
  if (!firstSegment.trim()) return null;

  let text = firstSegment;
  const boundaries = [{
    chunkIdx: startIdx,
    offsetInUtterance: 0,
    baseCharOffset: startCharOffset,
  }];

  let i = startIdx + 1;
  while (i < allChunks.length) {
    const next = allChunks[i];
    if (!next) { i++; continue; }
    const projected = text.length + 1 + next.length; // +1 for joining space
    if (projected > MAX_UTTERANCE_CHARS) break;
    boundaries.push({
      chunkIdx: i,
      offsetInUtterance: text.length + 1,
      baseCharOffset: 0,
    });
    text = text + ' ' + next;
    i++;
  }

  return { text, boundaries, nextIdx: i };
}

// Resolve a char position within the utterance to {chunkIdx, localChar}, where
// localChar is the absolute char offset within that display chunk's text (what
// CurrentChunk uses to highlight a word).
function resolveBoundary(charInUtterance, boundaries) {
  for (let i = boundaries.length - 1; i >= 0; i--) {
    if (charInUtterance >= boundaries[i].offsetInUtterance) {
      const delta = charInUtterance - boundaries[i].offsetInUtterance;
      return {
        chunkIdx: boundaries[i].chunkIdx,
        localChar: Math.max(0, delta) + boundaries[i].baseCharOffset,
      };
    }
  }
  return {
    chunkIdx: boundaries[0].chunkIdx,
    localChar: boundaries[0].baseCharOffset,
  };
}

export function useSpeech({ chunks, selectedVoice, rate, pitch, volume }) {
  const [chunkIndex, setChunkIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scrollTrigger, setScrollTrigger] = useState(0);

  // wordIndex is not React state — updates go directly to subscribers so only
  // CurrentChunk re-renders on each tick, not the entire App/TextDisplay tree.
  const wordIndexRef = useRef(0);
  const wordIndexListeners = useRef(new Set());
  function setWordIndex(v) {
    wordIndexRef.current = v;
    wordIndexListeners.current.forEach(fn => fn());
  }
  const subscribeWordIndex = useCallback((cb) => {
    wordIndexListeners.current.add(cb);
    return () => wordIndexListeners.current.delete(cb);
  }, []);
  const getWordIndex = useCallback(() => wordIndexRef.current, []);

  const r = useRef({
    chunkIndex: 0,
    isPlaying: false,
    paused: false,
    stopped: false,
    lastCharIndex: 0,
    voice: selectedVoice,
    rate,
    pitch,
    volume,
    chunks,
    // Monotonic counter — each utterance gets a unique gen at creation time.
    speakGen: 0,
    // Watermark: any utterance with gen ≤ cancelThru is dead (its callbacks
    // must no-op). Bumped to current speakGen on cancel/pause/stop/seek.
    cancelThru: 0,
    // gen of the utterance currently speaking (set in its onstart).
    activeGen: 0,
  });

  // Sync props into ref on every render — immediate and avoids stale-ref window
  // that useEffect would leave between render and commit.
  r.current.voice = selectedVoice;
  r.current.rate = rate;
  r.current.pitch = pitch;
  r.current.volume = volume;
  r.current.chunks = chunks;

  // ─── Core speak function ────────────────────────────────────────────────────

  // Builds a batch starting at chunks[startIdx] from `startCharOffset`, queues
  // it as a single utterance, and on `onstart` prefetches the *next* batch so
  // the engine has zero JS-round-trip gap between batches.
  function doSpeak(startIdx, startCharOffset) {
    const batch = buildBatch(r.current.chunks, startIdx, startCharOffset);
    if (!batch) {
      // Empty/whitespace-only first chunk — skip past it.
      const next = startIdx + 1;
      if (next < r.current.chunks.length) {
        doSpeak(next, 0);
      } else {
        endOfText();
      }
      return;
    }

    const { text, boundaries, nextIdx } = batch;
    const gen = ++r.current.speakGen;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = r.current.voice;
    utterance.rate = r.current.rate;
    utterance.pitch = r.current.pitch;
    utterance.volume = r.current.volume;

    let graceTimer = null;
    let intervalId = null;
    // Estimator base: last known char position and the time it was observed.
    // Recalibrated on every onboundary so the estimator always extrapolates
    // forward from the most recent confirmed position rather than from t=0.
    let estBase = { charPos: 0, time: 0 };
    // Last chunkIdx we resolved to — avoids redundant setChunkIndex calls
    // and lets us detect cross-chunk transitions inside this batch.
    let lastResolvedChunk = -1;

    const isAlive = () => gen > r.current.cancelThru;
    const isActive = () => r.current.activeGen === gen && isAlive();

    const stopEstimator = () => {
      if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null; }
      if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
    };

    // Map a char-position-in-utterance to the display chunk it belongs to and
    // push that into UI state. Called from onstart (charIdx=0), onboundary
    // (engine charIndex), and the time estimator.
    const applyChar = (charInUtterance) => {
      const { chunkIdx, localChar } = resolveBoundary(charInUtterance, boundaries);
      if (chunkIdx !== lastResolvedChunk) {
        lastResolvedChunk = chunkIdx;
        if (r.current.chunkIndex !== chunkIdx) {
          r.current.chunkIndex = chunkIdx;
          setChunkIndex(chunkIdx);
        }
      }
      r.current.lastCharIndex = localChar;
      setWordIndex(localChar);
    };

    const tick = () => {
      if (!isActive()) { stopEstimator(); return; }
      const elapsedSec = (performance.now() - estBase.time) / 1000;
      const estimated = Math.min(
        text.length - 1,
        Math.floor(estBase.charPos + elapsedSec * ESTIMATED_CHARS_PER_SECOND * r.current.rate)
      );
      applyChar(estimated);
    };

    utterance.onstart = () => {
      if (!isAlive()) return;

      // This utterance is now audible — promote it to active and flip the UI
      // to the first chunk in this batch. Doing this in onstart (not in the
      // previous onend) keeps the highlight perfectly in sync with audio.
      r.current.activeGen = gen;
      r.current.utterance = utterance;
      estBase = { charPos: 0, time: performance.now() };
      applyChar(0);

      graceTimer = setTimeout(() => {
        graceTimer = null;
        if (!isActive()) return;
        intervalId = setInterval(tick, ESTIMATOR_TICK_MS);
      }, ESTIMATOR_GRACE_MS);

      // Prefetch the *next batch* into the engine's queue — this is what
      // kills the inter-batch gap. The engine starts speaking it the instant
      // we end.
      if (nextIdx < r.current.chunks.length && r.current.isPlaying) {
        doSpeak(nextIdx, 0);
      }
    };

    utterance.onboundary = (e) => {
      if (typeof e.charIndex !== 'number') return;
      // Boundary events should only fire on the speaking utterance, but guard
      // against engines that mis-route them to queued ones.
      if (!isActive()) return;
      // Recalibrate the estimator from this confirmed position so it
      // extrapolates forward accurately between boundary events.
      estBase = { charPos: e.charIndex, time: performance.now() };
      applyChar(e.charIndex);
    };

    utterance.onend = () => {
      stopEstimator();
      if (!isAlive()) return;
      if (!r.current.isPlaying || r.current.stopped) return;

      // If we prefetched a successor batch, its onstart will take over the
      // UI. Only the truly-last batch needs to wind things down.
      if (nextIdx >= r.current.chunks.length) endOfText();
    };

    utterance.onerror = (e) => {
      stopEstimator();
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      console.error('Speech error:', e.error);
    };

    window.speechSynthesis.speak(utterance);
  }

  function endOfText() {
    r.current.isPlaying = false;
    r.current.stopped = true;
    r.current.chunkIndex = 0;
    r.current.lastCharIndex = 0;
    r.current.activeGen = 0;
    setIsPlaying(false);
    setChunkIndex(0);
    setWordIndex(0);
  }

  // ─── Settings change during playback ────────────────────────────────────────

  useEffect(() => {
    if (!r.current.isPlaying) return;
    const { chunkIndex: ci, lastCharIndex } = r.current;
    silenceAndCancel();
    doSpeak(ci, lastCharIndex);
  }, [rate, pitch, volume, selectedVoice]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Public API ─────────────────────────────────────────────────────────────

  function play() {
    if (r.current.isPlaying) return;

    r.current.isPlaying = true;
    r.current.paused = false;
    r.current.stopped = false;
    setIsPlaying(true);
    setScrollTrigger(t => t + 1);

    const { chunkIndex: ci, lastCharIndex } = r.current;
    silenceAndCancel();
    doSpeak(ci, lastCharIndex);
  }

  function silenceAndCancel() {
    // Zero volume first — silences audio immediately even if the browser
    // delays the actual cancellation of the currently-speaking utterance.
    if (r.current.utterance) {
      r.current.utterance.volume = 0;
      r.current.utterance = null;
    }
    // Mark every utterance created so far as dead so their pending onend /
    // onstart callbacks (including any prefetched-and-queued ones) no-op.
    r.current.cancelThru = r.current.speakGen;
    r.current.activeGen = 0;
    window.speechSynthesis.cancel();
  }

  function pause() {
    if (!r.current.isPlaying) return;
    r.current.isPlaying = false;
    r.current.paused = true;
    setIsPlaying(false);
    silenceAndCancel();
  }

  function stop() {
    r.current.isPlaying = false;
    r.current.paused = false;
    r.current.stopped = true;
    // Note: chunkIndex/lastCharIndex are intentionally preserved so the saved
    // position in localStorage stays at where the user left off. Clicking
    // Start again with the same text shows the resume prompt.
    setIsPlaying(false);
    silenceAndCancel();
  }

  function skip(dir) {
    const { chunks: ch } = r.current;
    const newIndex = Math.max(0, Math.min(ch.length - 1, r.current.chunkIndex + dir));
    r.current.chunkIndex = newIndex;
    r.current.lastCharIndex = 0;
    setChunkIndex(newIndex);
    setWordIndex(0);

    if (r.current.isPlaying) {
      silenceAndCancel();
      doSpeak(newIndex, 0);
    }
  }

  function seekTo(index, charOffset = 0) {
    const { chunks: ch } = r.current;
    const newIndex = Math.max(0, Math.min(ch.length - 1, index));
    r.current.chunkIndex = newIndex;
    r.current.lastCharIndex = charOffset;
    setChunkIndex(newIndex);
    setWordIndex(charOffset);

    if (r.current.isPlaying) {
      silenceAndCancel();
      doSpeak(newIndex, charOffset);
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => { silenceAndCancel(); };
  }, []);

  return { isPlaying, chunkIndex, subscribeWordIndex, getWordIndex, scrollTrigger, play, pause, stop, skip, seekTo };
}
