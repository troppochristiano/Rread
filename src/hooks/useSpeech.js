import { useState, useRef, useEffect, useCallback } from 'react';

// Grace period before deciding a voice doesn't emit boundary events. On
// expiry the whole utterance batch is highlighted at once (cloud voices)
// rather than estimating which sentence inside the batch is being spoken.
const ESTIMATOR_GRACE_MS = 250;
// Separate, longer threshold for surfacing the "word highlighting unsupported"
// banner. Mobile engines often emit the first boundary event >250ms after
// onstart, so the visual fallback fires first but the banner waits for a
// confident signal — avoids a flash of the banner when boundaries are merely
// late, not absent.
const UNSUPPORTED_DETECTION_MS = 1500;
// If boundary events arrive and then go silent mid-utterance, fall back to
// whole-batch highlight after this many ms of silence. Long enough that
// natural pauses between sentences don't briefly flash the whole batch.
const BOUNDARY_SILENCE_MS = 3000;

// Chunks (paragraph-sized — the unit of display/seek/highlight) get batched
// into larger utterances at speak-time. Each utterance carries an end-of-
// utterance silence the engine inserts on its own (~150-300ms), which is the
// audible "gap" between chunks. Batching collapses N gaps into 1. 1500 is
// comfortable for all engines tested without losing `onboundary` accuracy.
// Paragraphs longer than this are split internally at sentence boundaries
// while remaining a single display chunk.
const MAX_UTTERANCE_CHARS = 1500;

// Find a natural break point ≤ maxLen for splitting an oversized paragraph
// across utterances. Prefers sentence boundaries, then weaker pauses, then
// whitespace. Falls back to a hard cut at maxLen if nothing else fits.
function findUtteranceBreak(text, maxLen) {
  for (const re of [
    /[.!?…]["']?\s+/g,
    /[;—]\s+/g,
    /[:]\s+/g,
    /,\s+/g,
    /\s+/g,
  ]) {
    re.lastIndex = 0;
    let lastEnd = -1;
    let m;
    while ((m = re.exec(text)) !== null) {
      const end = m.index + m[0].length;
      if (end > maxLen) break;
      lastEnd = end;
    }
    if (lastEnd > 0) return lastEnd;
  }
  return maxLen;
}

// Pack chunks[startIdx..] (starting from `startCharOffset` within the first
// chunk) into one utterance up to MAX_UTTERANCE_CHARS. Returns the joined
// text plus a boundary table mapping char-positions-in-utterance back to the
// originating display chunk, so `onboundary` can flip the UI to the right
// chunk as audio progresses through the batch. If the first chunk alone
// exceeds the limit, splits it internally — the display chunk stays one
// paragraph but the engine receives multiple utterances mapping back to the
// same chunkIdx.
function buildBatch(allChunks, startIdx, startCharOffset) {
  if (startIdx >= allChunks.length) return null;
  const firstSegment = allChunks[startIdx].slice(startCharOffset);
  if (!firstSegment.trim()) return null;

  if (firstSegment.length > MAX_UTTERANCE_CHARS) {
    const splitPoint = findUtteranceBreak(firstSegment, MAX_UTTERANCE_CHARS);
    return {
      text: firstSegment.slice(0, splitPoint).trimEnd(),
      boundaries: [{
        chunkIdx: startIdx,
        offsetInUtterance: 0,
        baseCharOffset: startCharOffset,
      }],
      nextIdx: startIdx,
      nextCharOffset: startCharOffset + splitPoint,
    };
  }

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
    if (next.length > MAX_UTTERANCE_CHARS) break; // oversized chunk needs its own pass
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

  return { text, boundaries, nextIdx: i, nextCharOffset: 0 };
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
  // Last chunkIdx of the active utterance's batch. When the voice emits
  // boundary events, this stays === chunkIndex (single-sentence highlight).
  // When it doesn't (cloud voices) we expand it to cover the whole batch.
  const [batchEndIndex, setBatchEndIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const [speechError, setSpeechError] = useState(null);
  // null = unknown (haven't detected yet), true = boundary events seen for
  // this voice, false = grace expired without any boundary (cloud/no-word
  // voice). Reset whenever the selected voice changes.
  const [wordHighlightSupported, setWordHighlightSupported] = useState(null);
  const boundarySeenForVoiceRef = useRef(false);

  // wordIndex is not React state — updates go directly to subscribers so only
  // CurrentChunk re-renders on each boundary event, not the entire App tree.
  // -1 means "no word highlighted" (voice doesn't support boundary events).
  const wordIndexRef = useRef(-1);
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
    batchEndIndex: 0,
    isPlaying: false,
    paused: false,
    stopped: false,
    lastCharIndex: 0,
    voice: selectedVoice,
    rate,
    pitch,
    volume,
    chunks,
    speakGen: 0,
    cancelThru: 0,
    activeGen: 0,
  });

  r.current.voice = selectedVoice;
  r.current.rate = rate;
  r.current.pitch = pitch;
  r.current.volume = volume;
  r.current.chunks = chunks;

  function writeChunkIndex(idx) {
    if (r.current.chunkIndex !== idx) {
      r.current.chunkIndex = idx;
      setChunkIndex(idx);
    }
  }

  function writeBatchEnd(idx) {
    if (r.current.batchEndIndex !== idx) {
      r.current.batchEndIndex = idx;
      setBatchEndIndex(idx);
    }
  }

  // ─── Core speak function ────────────────────────────────────────────────────

  function doSpeak(startIdx, startCharOffset) {
    const batch = buildBatch(r.current.chunks, startIdx, startCharOffset);
    if (!batch) {
      const next = startIdx + 1;
      if (next < r.current.chunks.length) {
        doSpeak(next, 0);
      } else {
        endOfText();
      }
      return;
    }

    const { text, boundaries, nextIdx, nextCharOffset } = batch;
    const endChunkIdx = boundaries[boundaries.length - 1].chunkIdx;
    const gen = ++r.current.speakGen;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = r.current.voice;
    utterance.rate = r.current.rate;
    utterance.pitch = r.current.pitch;
    utterance.volume = r.current.volume;

    let graceTimer = null;
    let unsupportedTimer = null;
    let reArmTimer = null;
    let lastResolvedChunk = -1;

    const isAlive = () => gen > r.current.cancelThru;
    const isActive = () => r.current.activeGen === gen && isAlive();

    const clearTimers = () => {
      if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null; }
      if (unsupportedTimer !== null) { clearTimeout(unsupportedTimer); unsupportedTimer = null; }
      if (reArmTimer !== null) { clearTimeout(reArmTimer); reArmTimer = null; }
    };

    // Cloud-voice fallback: no boundary events to drive per-sentence tracking,
    // so highlight everything from the current chunk through the end of the
    // batch as one block until the next utterance starts.
    const expandToBatch = () => {
      setWordIndex(-1);
      writeBatchEnd(endChunkIdx);
    };

    // Authoritative update from a boundary event: advances both the sentence
    // highlight and the word highlight, and collapses any batch-wide highlight
    // back to the single active chunk.
    const applyChar = (charInUtterance) => {
      const { chunkIdx, localChar } = resolveBoundary(charInUtterance, boundaries);
      if (chunkIdx !== lastResolvedChunk) {
        lastResolvedChunk = chunkIdx;
        writeChunkIndex(chunkIdx);
      }
      writeBatchEnd(chunkIdx);
      r.current.lastCharIndex = localChar;
      setWordIndex(localChar);
    };

    utterance.onstart = () => {
      if (!isAlive()) return;

      r.current.activeGen = gen;
      r.current.utterance = utterance;

      // Snap to first chunk of the batch immediately on audio start.
      const { chunkIdx } = resolveBoundary(0, boundaries);
      lastResolvedChunk = chunkIdx;
      writeChunkIndex(chunkIdx);
      writeBatchEnd(chunkIdx);

      // If no boundary event arrives in the grace window, expand the
      // highlight to cover the whole batch. Cloud voices stay here for the
      // duration of the utterance.
      graceTimer = setTimeout(() => {
        graceTimer = null;
        if (!isActive()) return;
        expandToBatch();
      }, ESTIMATOR_GRACE_MS);

      // Longer, separate window before surfacing the "unsupported" banner —
      // on mobile the first boundary often arrives well after the visual
      // grace, and we don't want the banner to flash for late-but-present
      // boundary events.
      unsupportedTimer = setTimeout(() => {
        unsupportedTimer = null;
        if (!isActive()) return;
        if (!boundarySeenForVoiceRef.current) setWordHighlightSupported(false);
      }, UNSUPPORTED_DETECTION_MS);

      if (nextIdx < r.current.chunks.length && r.current.isPlaying) {
        doSpeak(nextIdx, nextCharOffset);
      }
    };

    utterance.onboundary = (e) => {
      if (typeof e.charIndex !== 'number') return;
      if (!isActive()) return;
      // A real boundary arrived — cancel grace + unsupported-detection timers.
      if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null; }
      if (unsupportedTimer !== null) { clearTimeout(unsupportedTimer); unsupportedTimer = null; }
      if (!boundarySeenForVoiceRef.current) {
        boundarySeenForVoiceRef.current = true;
        setWordHighlightSupported(true);
      }
      applyChar(e.charIndex);
      // Watchdog: if boundaries go silent, fall back to whole-batch highlight.
      if (reArmTimer !== null) clearTimeout(reArmTimer);
      reArmTimer = setTimeout(() => {
        reArmTimer = null;
        if (!isActive()) return;
        expandToBatch();
      }, BOUNDARY_SILENCE_MS);
    };

    utterance.onend = () => {
      clearTimers();
      if (!isAlive()) return;
      if (!r.current.isPlaying || r.current.stopped) return;
      if (nextIdx >= r.current.chunks.length) endOfText();
    };

    utterance.onerror = (e) => {
      clearTimers();
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      console.error('Speech error:', e.error);
      r.current.isPlaying = false;
      setIsPlaying(false);
      setSpeechError(e.error);
    };

    window.speechSynthesis.speak(utterance);
  }

  function endOfText() {
    r.current.isPlaying = false;
    r.current.stopped = true;
    r.current.chunkIndex = 0;
    r.current.batchEndIndex = 0;
    r.current.lastCharIndex = 0;
    r.current.activeGen = 0;
    setIsPlaying(false);
    setChunkIndex(0);
    setBatchEndIndex(0);
    setWordIndex(-1);
  }

  // ─── Settings change during playback ────────────────────────────────────────

  useEffect(() => {
    if (!r.current.isPlaying) return;
    const id = setTimeout(() => {
      if (!r.current.isPlaying) return;
      const { chunkIndex: ci, lastCharIndex } = r.current;
      silenceAndCancel();
      doSpeak(ci, lastCharIndex);
    }, 300);
    return () => clearTimeout(id);
  }, [rate, pitch, volume, selectedVoice]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-detect word-highlight support when the user picks a different voice.
  const lastVoiceRef = useRef(selectedVoice);
  if (lastVoiceRef.current !== selectedVoice) {
    lastVoiceRef.current = selectedVoice;
    boundarySeenForVoiceRef.current = false;
    if (wordHighlightSupported !== null) setWordHighlightSupported(null);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  function play() {
    if (r.current.isPlaying) return;
    r.current.isPlaying = true;
    r.current.paused = false;
    r.current.stopped = false;
    setSpeechError(null);
    setIsPlaying(true);
    setScrollTrigger(t => t + 1);
    const { chunkIndex: ci, lastCharIndex } = r.current;
    silenceAndCancel();
    doSpeak(ci, lastCharIndex);
  }

  function silenceAndCancel() {
    if (r.current.utterance) {
      r.current.utterance.volume = 0;
      r.current.utterance = null;
    }
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
    setSpeechError(null);
    setIsPlaying(false);
    silenceAndCancel();
  }

  function skip(dir) {
    const { chunks: ch } = r.current;
    const newIndex = Math.max(0, Math.min(ch.length - 1, r.current.chunkIndex + dir));
    r.current.chunkIndex = newIndex;
    r.current.batchEndIndex = newIndex;
    r.current.lastCharIndex = 0;
    setChunkIndex(newIndex);
    setBatchEndIndex(newIndex);
    setWordIndex(-1);
    if (r.current.isPlaying) {
      silenceAndCancel();
      doSpeak(newIndex, 0);
    }
  }

  function seekTo(index, charOffset = 0) {
    const { chunks: ch } = r.current;
    const newIndex = Math.max(0, Math.min(ch.length - 1, index));
    r.current.chunkIndex = newIndex;
    r.current.batchEndIndex = newIndex;
    r.current.lastCharIndex = charOffset;
    setChunkIndex(newIndex);
    setBatchEndIndex(newIndex);
    setWordIndex(charOffset);
    if (r.current.isPlaying) {
      silenceAndCancel();
      doSpeak(newIndex, charOffset);
    }
  }

  useEffect(() => {
    return () => { silenceAndCancel(); };
  }, []);

  // On iOS/mobile Safari the screen lock throttles JS for the hidden tab:
  // the silent-audio session keeps the speech engine running, but
  // `onboundary` callbacks get dropped, so wordIndex and chunkIndex (and
  // the persisted resume position) freeze at lock time even though audio
  // continued playing. On return-to-visible, cancel the in-flight utterance
  // and re-speak from the last known position to get the highlight and
  // saved position back in sync. A small threshold skips brief tab
  // switches where boundary events are still flowing.
  useEffect(() => {
    let hiddenAt = null;
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const hiddenMs = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = null;
      if (hiddenMs < 1500) return;
      if (!r.current.isPlaying) return;
      const { chunkIndex: ci, lastCharIndex } = r.current;
      silenceAndCancel();
      doSpeak(ci, lastCharIndex);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Watchdog: the onstart→doSpeak prefetch chain depends on JS callbacks
  // firing in a timely way. When the screen locks (or the tab backgrounds),
  // mobile browsers throttle timers/callbacks and the chain can stall,
  // leaving the engine queue empty while isPlaying is still true — audible
  // result: playback stops mid-text after the phone has been locked for a
  // while. This polls for a drained queue and re-kicks from the last known
  // position. Two consecutive drained ticks before kicking avoids racing the
  // natural between-utterance gap.
  useEffect(() => {
    if (!isPlaying) return;
    let drainedTicks = 0;
    const id = setInterval(() => {
      if (!r.current.isPlaying) return;
      const ss = window.speechSynthesis;
      if (ss.speaking || ss.pending) {
        drainedTicks = 0;
        return;
      }
      drainedTicks++;
      if (drainedTicks < 2) return;
      drainedTicks = 0;
      const { chunkIndex: ci, lastCharIndex } = r.current;
      silenceAndCancel();
      doSpeak(ci, lastCharIndex);
    }, 2000);
    return () => clearInterval(id);
  }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isPlaying, chunkIndex, batchEndIndex, subscribeWordIndex, getWordIndex, scrollTrigger,
    play, pause, stop, skip, seekTo,
    speechError, clearSpeechError: () => setSpeechError(null),
    wordHighlightSupported,
    dismissWordHighlightWarning: () => setWordHighlightSupported(true),
  };
}
