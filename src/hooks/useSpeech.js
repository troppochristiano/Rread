import { useState, useRef, useEffect, useCallback } from 'react';

// Grace period before deciding a voice doesn't support boundary events.
const ESTIMATOR_GRACE_MS = 250;
// Throttle for the chunk-level estimator.
const ESTIMATOR_TICK_MS = 100;
// If boundary events stop mid-utterance, switch to the chunk estimator after
// this many ms of silence.
const BOUNDARY_SILENCE_MS = 800;
// Fallback chars/sec for the first utterance before we have a measurement.
// Only used for sentence-level chunk tracking now (word highlight is off for
// boundary-less voices), so overshooting by one sentence is acceptable and
// a higher value is better than visibly lagging behind the audio.
const ESTIMATED_CHARS_PER_SECOND = 17;
// Thresholds for trusting an onend-based rate measurement.
const RATE_MEASURE_MIN_SECONDS = 0.5;
const RATE_MEASURE_MIN_CHARS = 10;
// Engines insert ~150-300ms of trailing silence before onend fires. Subtract
// a constant so the measured chars/sec reflects actual speaking time.
const TRAILING_SILENCE_MS = 150;

// Per-(voice, rate) chars/sec cache. Chunk-level tracking only needs a rough
// rate — a 10% error shifts the sentence highlight by ~1 sentence over a
// 50s batch, which is fine. The cache makes even that error disappear by the
// second session with a given voice.
const RATE_CACHE_KEY = 'tts_measured_rates';

function rateCacheRead() {
  try { return JSON.parse(localStorage.getItem(RATE_CACHE_KEY)) || {}; }
  catch { return {}; }
}
function rateCacheKey(voice, rate) {
  if (!voice) return null;
  const id = voice.voiceURI || voice.name;
  return id ? `${id}|${Number(rate).toFixed(2)}` : null;
}
function rateCacheLookup(voice, rate) {
  const key = rateCacheKey(voice, rate);
  if (!key) return null;
  const v = rateCacheRead()[key];
  return typeof v === 'number' && isFinite(v) && v > 0 ? v : null;
}
function rateCacheStore(voice, rate, value) {
  const key = rateCacheKey(voice, rate);
  if (!key || !isFinite(value) || value <= 0) return;
  try {
    const cache = rateCacheRead();
    cache[key] = value;
    localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

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
// originating display chunk, so `onboundary`/the estimator can flip the UI
// to the right chunk as audio progresses through the batch. If the first
// chunk alone exceeds the limit, splits it internally — the display chunk
// stays one paragraph but the engine receives multiple utterances mapping
// back to the same chunkIdx.
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [scrollTrigger, setScrollTrigger] = useState(0);

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
    // Measured chars/sec for the current voice+rate. Used only for chunk-level
    // tracking (sentence advance) — does not drive word highlight.
    measuredRate: null,
  });

  r.current.voice = selectedVoice;
  r.current.rate = rate;
  r.current.pitch = pitch;
  r.current.volume = volume;
  r.current.chunks = chunks;

  // ─── Core speak function ────────────────────────────────────────────────────

  function doSpeak(startIdx, startCharOffset) {
    // Warm-start from cache so sentence tracking is accurate from the first
    // utterance with a known voice, not just from the second onward.
    if (r.current.measuredRate == null) {
      const cached = rateCacheLookup(r.current.voice, r.current.rate);
      if (cached != null) r.current.measuredRate = cached;
    }

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
    const gen = ++r.current.speakGen;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = r.current.voice;
    utterance.rate = r.current.rate;
    utterance.pitch = r.current.pitch;
    utterance.volume = r.current.volume;

    let graceTimer = null;
    let intervalId = null;
    let reArmTimer = null;
    let estBase = { charPos: 0, time: 0 };
    let utteranceStartTime = null;
    let lastResolvedChunk = -1;

    const isAlive = () => gen > r.current.cancelThru;
    const isActive = () => r.current.activeGen === gen && isAlive();

    const clearTimers = () => {
      if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null; }
      if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
      if (reArmTimer !== null) { clearTimeout(reArmTimer); reArmTimer = null; }
    };

    const startChunkEstimator = () => {
      if (intervalId === null) intervalId = setInterval(tickChunk, ESTIMATOR_TICK_MS);
    };

    // Advance the sentence (chunk) highlight via time estimate. Only updates
    // chunkIndex — wordIndex stays at -1 for boundary-less voices.
    const tickChunk = () => {
      if (!isActive()) { clearInterval(intervalId); intervalId = null; return; }
      const elapsedSec = (performance.now() - estBase.time) / 1000;
      const charsPerSec = r.current.measuredRate ?? (ESTIMATED_CHARS_PER_SECOND * r.current.rate);
      const estimated = Math.min(text.length - 1, Math.floor(estBase.charPos + elapsedSec * charsPerSec));
      const { chunkIdx } = resolveBoundary(estimated, boundaries);
      if (chunkIdx !== lastResolvedChunk) {
        lastResolvedChunk = chunkIdx;
        if (r.current.chunkIndex !== chunkIdx) {
          r.current.chunkIndex = chunkIdx;
          setChunkIndex(chunkIdx);
        }
      }
    };

    // Full update from an authoritative boundary event: advances both the
    // sentence highlight and the word highlight within the sentence.
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

    utterance.onstart = () => {
      if (!isAlive()) return;

      r.current.activeGen = gen;
      r.current.utterance = utterance;
      utteranceStartTime = performance.now();
      estBase = { charPos: 0, time: utteranceStartTime };

      // Snap to first chunk of the batch immediately on audio start.
      const { chunkIdx } = resolveBoundary(0, boundaries);
      if (chunkIdx !== lastResolvedChunk) {
        lastResolvedChunk = chunkIdx;
        if (r.current.chunkIndex !== chunkIdx) {
          r.current.chunkIndex = chunkIdx;
          setChunkIndex(chunkIdx);
        }
      }

      // If no boundary event arrives in the grace window, start the chunk
      // estimator — sentences will advance by time, but no word is highlighted.
      graceTimer = setTimeout(() => {
        graceTimer = null;
        if (!isActive()) return;
        setWordIndex(-1);
        startChunkEstimator();
      }, ESTIMATOR_GRACE_MS);

      if (nextIdx < r.current.chunks.length && r.current.isPlaying) {
        doSpeak(nextIdx, nextCharOffset);
      }
    };

    utterance.onboundary = (e) => {
      if (typeof e.charIndex !== 'number') return;
      if (!isActive()) return;
      // A real boundary arrived — cancel the grace timer and stop any
      // chunk estimator that was running (e.g. after a re-arm).
      if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null; }
      if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
      estBase = { charPos: e.charIndex, time: performance.now() };
      applyChar(e.charIndex);
      // Watchdog: if boundaries go silent, fall back to chunk estimator.
      if (reArmTimer !== null) clearTimeout(reArmTimer);
      reArmTimer = setTimeout(() => {
        reArmTimer = null;
        if (!isActive()) return;
        setWordIndex(-1);
        startChunkEstimator();
      }, BOUNDARY_SILENCE_MS);
    };

    utterance.onend = () => {
      clearTimers();
      if (!isAlive()) return;
      // Measure chars/sec from total utterance duration. Used for chunk-level
      // sentence tracking on the next utterance with this voice.
      if (utteranceStartTime !== null) {
        const duration = (performance.now() - utteranceStartTime) / 1000;
        const speakingSeconds = Math.max(0.1, duration - TRAILING_SILENCE_MS / 1000);
        if (speakingSeconds >= RATE_MEASURE_MIN_SECONDS && text.length >= RATE_MEASURE_MIN_CHARS) {
          r.current.measuredRate = text.length / speakingSeconds;
          rateCacheStore(r.current.voice, r.current.rate, r.current.measuredRate);
        }
      }
      if (!r.current.isPlaying || r.current.stopped) return;
      if (nextIdx >= r.current.chunks.length) endOfText();
    };

    utterance.onerror = (e) => {
      clearTimers();
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
    setWordIndex(-1);
  }

  // ─── Settings change during playback ────────────────────────────────────────

  useEffect(() => {
    if (!r.current.isPlaying) return;
    r.current.measuredRate = rateCacheLookup(selectedVoice, rate);
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
    setIsPlaying(false);
    silenceAndCancel();
  }

  function skip(dir) {
    const { chunks: ch } = r.current;
    const newIndex = Math.max(0, Math.min(ch.length - 1, r.current.chunkIndex + dir));
    r.current.chunkIndex = newIndex;
    r.current.lastCharIndex = 0;
    setChunkIndex(newIndex);
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
    r.current.lastCharIndex = charOffset;
    setChunkIndex(newIndex);
    setWordIndex(charOffset);
    if (r.current.isPlaying) {
      silenceAndCancel();
      doSpeak(newIndex, charOffset);
    }
  }

  useEffect(() => {
    return () => { silenceAndCancel(); };
  }, []);

  return { isPlaying, chunkIndex, subscribeWordIndex, getWordIndex, scrollTrigger, play, pause, stop, skip, seekTo };
}
