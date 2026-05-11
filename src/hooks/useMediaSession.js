import { useEffect, useRef } from "react";

export function useMediaSession({
  title,
  isPlaying,
  active,
  onPlay,
  onPause,
  onStop,
  onSkip,
}) {
  const handlersRef = useRef({ onPlay, onPause, onStop, onSkip });
  useEffect(() => {
    handlersRef.current = { onPlay, onPause, onStop, onSkip };
  });

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: title || "RRead",
        artist: "RRead",
      });
    } catch {
      // some browsers throw on bare MediaMetadata construction; ignore
    }
  }, [title]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying
      ? "playing"
      : active
        ? "paused"
        : "none";
  }, [isPlaying, active]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action, handler) => {
      try { ms.setActionHandler(action, handler); } catch { /* unsupported action */ }
    };
    set("play", () => handlersRef.current.onPlay?.());
    set("pause", () => handlersRef.current.onPause?.());
    set("stop", () => handlersRef.current.onStop?.());
    set("nexttrack", () => handlersRef.current.onSkip?.(1));
    set("previoustrack", () => handlersRef.current.onSkip?.(-1));
    set("seekforward", () => handlersRef.current.onSkip?.(1));
    set("seekbackward", () => handlersRef.current.onSkip?.(-1));
    return () => {
      ["play", "pause", "stop", "nexttrack", "previoustrack", "seekforward", "seekbackward"]
        .forEach(a => set(a, null));
    };
  }, []);
}
