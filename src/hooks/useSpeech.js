import { useState, useRef, useEffect } from 'react';

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
  const [wordIndex, setWordIndex] = useState(0); // absolute char offset in current chunk
  const [isPlaying, setIsPlaying] = useState(false);
  const [scrollTrigger, setScrollTrigger] = useState(0);

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

  // Keep refs in sync with latest props/state
  useEffect(() => { r.current.voice = selectedVoice; }, [selectedVoice]);
  useEffect(() => { r.current.rate = rate; }, [rate]);
  useEffect(() => { r.current.pitch = pitch; }, [pitch]);
  useEffect(() => { r.current.volume = volume; }, [volume]);
  useEffect(() => { r.current.chunks = chunks; }, [chunks]);

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

  const prevSettings = useRef({ rate, pitch, volume, voice: selectedVoice });

  useEffect(() => {
    const prev = prevSettings.current;
    const changed =
      prev.rate !== rate ||
      prev.pitch !== pitch ||
      prev.volume !== volume ||
      prev.voice !== selectedVoice;

    prevSettings.current = { rate, pitch, volume, voice: selectedVoice };

    if (changed && r.current.isPlaying) {
      const { chunks: ch, chunkIndex: ci, lastCharIndex } = r.current;
      window.speechSynthesis.cancel();
      doSpeak(ch[ci], ci, lastCharIndex);
    }
  }); // no deps — runs after every render to catch any change

  // ─── Public API ─────────────────────────────────────────────────────────────

  function play() {
    if (r.current.isPlaying) return;

    r.current.isPlaying = true;
    r.current.paused = false;
    r.current.stopped = false;
    setIsPlaying(true);
    setScrollTrigger(t => t + 1);

    const { chunks: ch, chunkIndex: ci, lastCharIndex } = r.current;
    window.speechSynthesis.cancel();
    doSpeak(ch[ci], ci, lastCharIndex);
  }

  function pause() {
    if (!r.current.isPlaying) return;
    r.current.isPlaying = false;
    r.current.paused = true;
    // Bump speakGen so any in-flight onend or estimator tick becomes stale
    // and won't trigger advanceChunk or update lastCharIndex after we pause.
    ++r.current.speakGen;
    setIsPlaying(false);
    window.speechSynthesis.cancel();
  }

  function stop() {
    r.current.isPlaying = false;
    r.current.paused = false;
    r.current.stopped = true;
    r.current.chunkIndex = 0;
    r.current.lastCharIndex = 0;
    setIsPlaying(false);
    setChunkIndex(0);
    setWordIndex(0);
    window.speechSynthesis.cancel();
  }

  function skip(dir) {
    const { chunks: ch } = r.current;
    const newIndex = Math.max(0, Math.min(ch.length - 1, r.current.chunkIndex + dir));
    r.current.chunkIndex = newIndex;
    r.current.lastCharIndex = 0;
    setChunkIndex(newIndex);
    setWordIndex(0);

    if (r.current.isPlaying) {
      window.speechSynthesis.cancel();
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
      window.speechSynthesis.cancel();
      doSpeak(ch[newIndex], newIndex, charOffset);
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => { window.speechSynthesis.cancel(); };
  }, []);

  return { isPlaying, chunkIndex, wordIndex, scrollTrigger, play, pause, stop, skip, seekTo };
}
