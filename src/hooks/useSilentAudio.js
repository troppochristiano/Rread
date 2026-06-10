import { useCallback, useEffect, useRef } from "react";

// Browsers only show lock-screen / notification-shade media controls when a
// real HTMLAudioElement (or video) is playing. The Web Speech API alone does
// not qualify, so we play a looping inaudible WAV alongside speech to keep
// the system media session active. The MediaSession action handlers set in
// useMediaSession then route lock-screen play/pause/skip back into useSpeech.
//
// iOS notes:
// - Audio element must be in the DOM, with playsinline + webkit-playsinline.
// - play() must be initiated from a user gesture; later React effects do not
//   count, so App.jsx calls unlock() inside the click handler.
// - MediaSession on iOS requires HTTPS (or localhost). Plain-HTTP LAN testing
//   will not show a lock-screen player no matter what we do here.
function makeSilentWavBlob() {
  const sampleRate = 8000;
  // Desktop Chrome/Edge hide media from the Windows lock-screen / SMTC (Global
  // Media Controls) when the element's duration is under ~5s — short clips are
  // treated as UI "sounds" and filtered out. (Android's media notification has
  // no such rule, which is why a 1s loop was enough there.) Use a 30s clip so
  // the PC media player actually appears. freq below has an integer number of
  // cycles over the whole clip, so it still loops seamlessly.
  const numSamples = sampleRate * 30; // 30 seconds
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeString = (offset, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, numSamples * 2, true);
  // NOT pure silence: Android Chrome will not grant audio focus (and therefore
  // shows no lock-screen player and suspends speechSynthesis when the screen
  // is off) for an all-zero track. Write a very faint sine — ~-54 dBFS at a
  // frequency with an integer period over the 1s loop, so it's effectively
  // inaudible but still registers as real, non-silent audio.
  const amplitude = 64; // out of 32767 (~ -54 dBFS)
  const freq = 220; // integer cycles per second -> clean loop boundary
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate));
    view.setInt16(44 + i * 2, sample, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function createSilentAudio() {
  const audio = document.createElement("audio");
  audio.loop = true;
  audio.preload = "auto";
  audio.setAttribute("playsinline", "");
  audio.setAttribute("webkit-playsinline", "");
  audio.src = URL.createObjectURL(makeSilentWavBlob());
  audio.style.position = "fixed";
  audio.style.width = "0";
  audio.style.height = "0";
  audio.style.opacity = "0";
  audio.style.pointerEvents = "none";
  document.body.appendChild(audio);
  audio.load();
  return audio;
}

export function useSilentAudio(isPlaying, keepAlive = false) {
  const audioRef = useRef(null);
  const unlockedRef = useRef(false);

  useEffect(() => {
    audioRef.current = createSilentAudio();
    return () => {
      const a = audioRef.current;
      if (a) {
        a.pause();
        try { URL.revokeObjectURL(a.src); } catch { /* noop */ }
        if (a.parentNode) a.parentNode.removeChild(a);
        audioRef.current = null;
      }
    };
  }, []);

  // Call from a user gesture (click/tap) so iOS will permit subsequent play().
  const unlock = useCallback(() => {
    const a = audioRef.current;
    if (!a || unlockedRef.current) return;
    const p = a.play();
    if (p && typeof p.then === "function") {
      p.then(() => { unlockedRef.current = true; }).catch(() => { /* user gesture missing */ });
    } else {
      unlockedRef.current = true;
    }
  }, []);

  // Keep the silent track playing for the whole reading session (keepAlive),
  // not only while speech is sounding. The system media session — and with it
  // the Windows lock-screen / SMTC player — only stays registered while a real
  // audio element is playing. Holding it alive while paused/stopped means that
  // when the PC is locked ("blocked") the media player is still shown, sitting
  // in a paused state (useMediaSession reports playbackState="paused"), so its
  // Play button is available and routes back through the MediaSession "play"
  // action into useSpeech — i.e. you can start playback from the locked PC.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying || keepAlive) {
      a.play().catch(() => { /* not yet unlocked; will retry on next user gesture */ });
    } else {
      a.pause();
    }
  }, [isPlaying, keepAlive]);

  // Diagnostics for the lock-screen player debug overlay (?msdebug=1).
  const getState = useCallback(() => {
    const a = audioRef.current;
    if (!a) return { exists: false };
    return {
      exists: true,
      paused: a.paused,
      currentTime: Number(a.currentTime.toFixed(2)),
      readyState: a.readyState,
      muted: a.muted,
      volume: a.volume,
      unlocked: unlockedRef.current,
      error: a.error ? a.error.code : null,
    };
  }, []);

  return { unlock, getState };
}
