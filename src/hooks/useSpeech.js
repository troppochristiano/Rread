import { useState, useRef, useEffect, useCallback } from 'react';

// Approx chars/sec a TTS voice utters at rate=1. Used as a fallback for voices
// that never fire `onboundary` (Microsoft "Online"/"Natural", most Google
// voices). ~150 wpm × ~6 chars/word ≈ 15.
const ESTIMATED_CHARS_PER_SECOND = 15;
// Grace period before the estimator kicks in, so voices that *do* support
// boundaries get to fire one first and suppress the estimator.
const ESTIMATOR_GRACE_MS = 250;
// Throttle the estimator — words are spoken at ~2-3/sec so 100ms is plenty.
const ESTIMATOR_TICK_MS = 100;

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
    speakGen: 0, // incremented each doSpeak call to cancel stale onend
  });

  // Sync props into ref on every render — immediate and avoids stale-ref window
  // that useEffect would leave between render and commit.
  r.current.voice = selectedVoice;
  r.current.rate = rate;
  r.current.pitch = pitch;
  r.current.volume = volume;
  r.current.chunks = chunks;

  // ─── Core speak function ────────────────────────────────────────────────────

  function doSpeak(chunkText, index, charOffset) {
    const text = chunkText.slice(charOffset);
    if (!text.trim()) {
      advanceChunk(index);
      return;
    }

    const gen = ++r.current.speakGen;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = r.current.voice;
    utterance.rate = r.current.rate;
    utterance.pitch = r.current.pitch;
    utterance.volume = r.current.volume;

    // Time-based fallback for voices that don't emit word boundaries.
    let realBoundaryFired = false;
    let graceTimer = null;
    let intervalId = null;
    let startTime = 0;

    const stopEstimator = () => {
      if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null; }
      if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
    };

    const tick = () => {
      if (gen !== r.current.speakGen || realBoundaryFired) {
        stopEstimator();
        return;
      }
      const elapsedSec = (performance.now() - startTime) / 1000;
      const estimated = Math.min(
        text.length - 1,
        Math.floor(elapsedSec * ESTIMATED_CHARS_PER_SECOND * r.current.rate)
      );
      const abs = charOffset + estimated;
      // Skip state update if estimated position hasn't moved to a new word boundary
      if (abs === r.current.lastCharIndex) return;
      r.current.lastCharIndex = abs;
      setWordIndex(abs);
    };

    utterance.onstart = () => {
      if (gen !== r.current.speakGen) return;
      startTime = performance.now();
      graceTimer = setTimeout(() => {
        graceTimer = null;
        if (gen !== r.current.speakGen || realBoundaryFired) return;
        intervalId = setInterval(tick, ESTIMATOR_TICK_MS);
      }, ESTIMATOR_GRACE_MS);
    };

    utterance.onboundary = (e) => {
      // Accept any boundary event — some voices/browsers fire 'sentence'
      // instead of 'word', or omit e.name entirely.
      if (typeof e.charIndex !== 'number') return;
      realBoundaryFired = true;
      stopEstimator();
      const abs = charOffset + e.charIndex;
      r.current.lastCharIndex = abs;
      setWordIndex(abs);
    };

    utterance.onend = () => {
      stopEstimator();
      // Stale utterance (cancelled and replaced) — ignore
      if (gen !== r.current.speakGen) return;
      if (!r.current.isPlaying || r.current.stopped) return;
      advanceChunk(index);
    };

    utterance.onerror = (e) => {
      stopEstimator();
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      console.error('Speech error:', e.error);
    };

    r.current.utterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  function advanceChunk(index) {
    const { chunks: ch } = r.current;
    const next = index + 1;
    if (next < ch.length) {
      r.current.chunkIndex = next;
      r.current.lastCharIndex = 0;
      setChunkIndex(next);
      setWordIndex(0);
      // Guard: don't start next chunk if playback was paused/stopped in the
      // moment between the utterance ending and this callback firing.
      if (r.current.isPlaying) doSpeak(ch[next], next, 0);
    } else {
      // Reached end
      r.current.isPlaying = false;
      r.current.stopped = true;
      r.current.chunkIndex = 0;
      r.current.lastCharIndex = 0;
      setIsPlaying(false);
      setChunkIndex(0);
      setWordIndex(0);
    }
  }

  // ─── Settings change during playback ────────────────────────────────────────

  useEffect(() => {
    if (!r.current.isPlaying) return;
    const { chunks: ch, chunkIndex: ci, lastCharIndex } = r.current;
    silenceAndCancel();
    doSpeak(ch[ci], ci, lastCharIndex);
  }, [rate, pitch, volume, selectedVoice]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Public API ─────────────────────────────────────────────────────────────

  function play() {
    if (r.current.isPlaying) return;

    r.current.isPlaying = true;
    r.current.paused = false;
    r.current.stopped = false;
    setIsPlaying(true);
    setScrollTrigger(t => t + 1);

    const { chunks: ch, chunkIndex: ci, lastCharIndex } = r.current;
    silenceAndCancel();
    doSpeak(ch[ci], ci, lastCharIndex);
  }

  function silenceAndCancel() {
    // Zero volume first — silences audio immediately even if the browser
    // delays the actual cancellation of the utterance.
    if (r.current.utterance) {
      r.current.utterance.volume = 0;
      r.current.utterance = null;
    }
    window.speechSynthesis.cancel();
  }

  function pause() {
    if (!r.current.isPlaying) return;
    r.current.isPlaying = false;
    r.current.paused = true;
    // Bump speakGen so any in-flight onend or estimator tick becomes stale
    // and won't trigger advanceChunk or update lastCharIndex after we pause.
    ++r.current.speakGen;
    setIsPlaying(false);
    silenceAndCancel();
  }

  function stop() {
    r.current.isPlaying = false;
    r.current.paused = false;
    r.current.stopped = true;
    // Bump speakGen so any in-flight onend from the last utterance can't
    // trigger advanceChunk after stop() has already run.
    ++r.current.speakGen;
    r.current.chunkIndex = 0;
    r.current.lastCharIndex = 0;
    setIsPlaying(false);
    setChunkIndex(0);
    setWordIndex(0);
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
      doSpeak(ch[newIndex], newIndex, 0);
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
      doSpeak(ch[newIndex], newIndex, charOffset);
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => { silenceAndCancel(); };
  }, []);

  return { isPlaying, chunkIndex, subscribeWordIndex, getWordIndex, scrollTrigger, play, pause, stop, skip, seekTo };
}
