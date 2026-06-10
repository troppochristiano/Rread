import { useState, useRef, useEffect, useCallback } from 'react';
import { MAX_UTTERANCE_CHARS, findUtteranceBreak } from '../utils/utteranceBatch.js';

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

// Advance a char offset past the word it lands on, then past trailing
// whitespace, so the returned offset points at the START of the NEXT word.
// Used on resume after a stall to avoid re-speaking the word the highlight
// was frozen on (the engine almost certainly already played it).
function advancePastWord(text, off) {
  let i = Math.max(0, Math.min(off, text.length));
  while (i < text.length && !/\s/.test(text[i])) i++;
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

// The visibility-change re-fire and the drained-queue watchdog exist to
// compensate for mobile-only quirks (iOS screen-lock callback throttling, the
// onstart→doSpeak prefetch chain stalling under aggressive timer throttling).
// Desktop engines don't exhibit those failure modes, and re-firing there
// would cause unwanted utterance restarts on tab switches and false-positive
// re-kicks during normal inter-utterance pauses. Gate both effects on this.
const IS_MOBILE = typeof navigator !== 'undefined'
  && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Rough characters-per-second the engine speaks at rate=1.0. Used to
// estimate how far audio progressed past `lastCharIndex` during periods
// when boundary callbacks were throttled (typically iOS screen lock).
// English TTS at default rate is ~150 wpm × ~5 chars/word ≈ 12-14 ch/s;
// 12 keeps the estimate slightly conservative so we lean toward replaying
// a word over skipping content.
const ESTIMATED_CHARS_PER_SEC_RATE_1 = 12;

// Walk an `advance` count of chars forward from (idx, off), crossing chunk
// boundaries (each inter-chunk space counts as one char to match how
// buildBatch joins chunks with a single space). Returns the resulting
// {idx, off}, clamped to the end of the last chunk.
function advanceCharsAcrossChunks(chunks, idx, off, advance) {
  let curIdx = idx;
  let curOff = off;
  while (curIdx < chunks.length && advance > 0) {
    const remaining = chunks[curIdx].length - curOff;
    if (advance <= remaining) {
      curOff += advance;
      return { idx: curIdx, off: curOff };
    }
    advance -= remaining + 1; // +1 for the joining space between chunks
    curIdx++;
    curOff = 0;
  }
  if (curIdx >= chunks.length) {
    const last = Math.max(0, chunks.length - 1);
    return { idx: last, off: chunks[last]?.length ?? 0 };
  }
  return { idx: curIdx, off: curOff };
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
  // Wall-clock timestamp of the last boundary event from any utterance. Used
  // by the boundary-silence watchdog to detect when JS callbacks got
  // throttled (typically by an iOS screen lock with active audio session)
  // and the highlight/position has frozen even though audio kept going.
  const lastBoundaryTsRef = useRef(0);
  // True once the page has been hidden during the current playback (screen
  // lock / tab switch). Gates the elapsed-time forward projection and the
  // whole-batch fallbacks: while the page stays visible, boundary events are
  // authoritative even when sparse, so those throttle-recovery paths must NOT
  // fire — otherwise they cancel/reseek a healthy engine and the highlight
  // jumps around. Reset back to false once a visible re-speak consumes it.
  const wasHiddenRef = useRef(false);

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

  // Estimate where audio actually is now, given the last confirmed boundary
  // and the wall-clock time elapsed since. When boundary events were flowing
  // up to `now`, this returns approximately (chunkIndex, lastCharIndex). When
  // they've been silent (phone lock throttling), the engine kept speaking,
  // so the returned position projects ESTIMATED_CHARS_PER_SEC × rate × elapsed
  // chars forward — close to where audio truly ended up. Snaps forward to the
  // next word start so we never restart mid-word.
  function estimateResumePosition() {
    const { chunkIndex: ci, lastCharIndex } = r.current;
    const chunks = r.current.chunks;
    const lastTs = lastBoundaryTsRef.current;
    // Only project forward if the page was actually hidden while playing.
    // While visible, boundary events track the true position even when sparse,
    // so projecting past lastCharIndex would skip the highlight ahead.
    if (!lastTs || !boundarySeenForVoiceRef.current || !wasHiddenRef.current) {
      return { idx: ci, off: lastCharIndex };
    }
    const elapsedSec = Math.max(0, (Date.now() - lastTs) / 1000);
    const advance = Math.floor(elapsedSec * ESTIMATED_CHARS_PER_SEC_RATE_1 * r.current.rate);
    if (advance <= 0) return { idx: ci, off: lastCharIndex };
    const projected = advanceCharsAcrossChunks(chunks, ci, lastCharIndex, advance);
    const text = chunks[projected.idx] || '';
    const snapped = advancePastWord(text, projected.off);
    return { idx: projected.idx, off: snapped };
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

    // Word tokens of this utterance, used to re-anchor unreliable boundary
    // charIndex values (see locateChar). Some mobile engines report a charIndex
    // that lands on the WRONG occurrence of a repeated word — e.g. while
    // speaking the first "28 August" they report the index of a later
    // identical "28 August" elsewhere in the batch, so the highlight jumps to
    // the wrong place. Built once per utterance.
    const utterTokens = [];
    {
      const re = /\S+/g;
      let m;
      while ((m = re.exec(text)) !== null) utterTokens.push({ text: m[0], start: m.index });
    }
    // Monotonic cursor (index into utterTokens) marking how far audio has
    // progressed. Words are spoken in order, so we only ever search forward.
    let tokenCursor = 0;

    const wordCovering = (idx) => {
      for (let k = 0; k < utterTokens.length; k++) {
        const tk = utterTokens[k];
        if (idx >= tk.start && idx < tk.start + tk.text.length) return tk.text;
      }
      return '';
    };

    // Map the engine's (possibly wrong-occurrence) charIndex to a trustworthy
    // char position: take the word the engine *names* and re-locate it at the
    // next occurrence from our monotonic cursor. For well-behaved engines the
    // next occurrence IS the reported one, so behaviour is unchanged. If the
    // word can't be matched ahead (engine normalized it, or jumped backward),
    // fall back to the raw index — no worse than before.
    const locateChar = (engineChar) => {
      const w = wordCovering(engineChar);
      if (!w) return engineChar;
      for (let k = tokenCursor; k < utterTokens.length; k++) {
        if (utterTokens[k].text === w) { tokenCursor = k; return utterTokens[k].start; }
      }
      return engineChar;
    };

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
      const located = locateChar(charInUtterance);
      const { chunkIdx, localChar } = resolveBoundary(located, boundaries);
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
      lastBoundaryTsRef.current = Date.now();

      // Snap to first chunk of the batch immediately on audio start.
      const { chunkIdx } = resolveBoundary(0, boundaries);
      lastResolvedChunk = chunkIdx;
      writeChunkIndex(chunkIdx);
      writeBatchEnd(chunkIdx);

      // Defer the play-time scroll-into-view until audio actually starts, so
      // the scroll motion and the first word highlight appear together
      // instead of scroll-then-pause-then-highlight on mobile engines that
      // take a moment to spin up.
      if (r.current.scrollPending) {
        r.current.scrollPending = false;
        setScrollTrigger(t => t + 1);
      }

      // If no boundary event arrives in the grace window, expand the
      // highlight to cover the whole batch. Cloud voices stay here for the
      // duration of the utterance.
      graceTimer = setTimeout(() => {
        graceTimer = null;
        if (!isActive()) return;
        // Once this voice has been confirmed to emit boundary events, don't
        // flash the whole-batch highlight (and its autoscroll) just because
        // the first boundary of this utterance is a little late — common on
        // mobile engines. Only voices that have never emitted a boundary
        // (cloud voices) fall through to the whole-batch fallback.
        if (boundarySeenForVoiceRef.current) return;
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
      lastBoundaryTsRef.current = Date.now();
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
        // A gap between boundary events only means audio froze (and we should
        // fall back to whole-batch highlight) when JS was actually throttled —
        // i.e. the page is hidden. While visible, sparse boundaries are normal
        // on mobile engines, so keep the current word highlight in place
        // instead of expanding to the whole batch and triggering autoscroll.
        if (!document.hidden) return;
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
    r.current.scrollPending = true;
    setSpeechError(null);
    setIsPlaying(true);
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
  // and re-speak from the elapsed-time-estimated position to get the
  // highlight and saved position back in sync. A small threshold skips
  // brief tab switches where boundary events are still flowing.
  useEffect(() => {
    if (!IS_MOBILE) return;
    let hiddenAt = null;
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        wasHiddenRef.current = true;
        return;
      }
      const hiddenMs = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = null;
      if (hiddenMs < 1500) { wasHiddenRef.current = false; return; }
      if (!r.current.isPlaying) { wasHiddenRef.current = false; return; }
      // Project from the elapsed-time estimate (wasHiddenRef is still true
      // here), then clear it so later visible re-kicks resume from the exact
      // last boundary position rather than guessing ahead.
      const resume = estimateResumePosition();
      wasHiddenRef.current = false;
      silenceAndCancel();
      doSpeak(resume.idx, resume.off);
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
    if (!IS_MOBILE) return;
    if (!isPlaying) return;
    let drainedTicks = 0;
    const id = setInterval(() => {
      if (!r.current.isPlaying) return;
      const ss = window.speechSynthesis;
      // Boundary-silence re-kick: covers the iOS screen-lock case where the
      // audio session stayed alive but boundary callbacks were throttled, so
      // the engine is still speaking but our highlight/position froze. Gated
      // on document.hidden — while the page is visible, sparse boundary events
      // are normal on some mobile engines and must not trigger a cancel/reseek
      // of a healthy engine. Also requires a confirmed boundary-emitting voice,
      // otherwise we'd thrash on cloud voices that legitimately never emit.
      if (document.hidden && ss.speaking && boundarySeenForVoiceRef.current
          && lastBoundaryTsRef.current
          && Date.now() - lastBoundaryTsRef.current > 6000) {
        drainedTicks = 0;
        const resume = estimateResumePosition();
        silenceAndCancel();
        doSpeak(resume.idx, resume.off);
        return;
      }
      if (ss.speaking || ss.pending) {
        drainedTicks = 0;
        return;
      }
      drainedTicks++;
      if (drainedTicks < 2) return;
      drainedTicks = 0;
      const resume = estimateResumePosition();
      silenceAndCancel();
      doSpeak(resume.idx, resume.off);
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
