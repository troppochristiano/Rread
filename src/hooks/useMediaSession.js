import { useEffect, useRef } from "react";

// Android's lock-screen / notification media player often won't render without
// artwork. Generate a simple raster icon once (SVG artwork is unreliable on
// Android) and reuse it as the MediaMetadata artwork.
let artworkCache;
function getArtwork() {
  if (artworkCache !== undefined) return artworkCache;
  try {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0f0f12";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 220px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("RR", size / 2, size / 2 + 10);
    const src = canvas.toDataURL("image/png");
    artworkCache = [
      { src, sizes: "96x96", type: "image/png" },
      { src, sizes: "192x192", type: "image/png" },
      { src, sizes: "512x512", type: "image/png" },
    ];
  } catch {
    artworkCache = [];
  }
  return artworkCache;
}

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
        artwork: getArtwork(),
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

    // Firefox (and some Chromium builds) only render the lock-screen /
    // notification player once a position state has been published. The Web
    // Speech API has no real timeline, so we advertise an unbounded "live"
    // stream (duration: Infinity) — that surfaces the controls without
    // implying a seekable scrubber. Clear it when nothing is active.
    if (typeof navigator.mediaSession.setPositionState !== "function") return;
    const setPos = (duration) =>
      navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position: 0 });
    try {
      if (active) {
        try {
          setPos(Infinity);
        } catch {
          // Some engines reject Infinity duration — fall back to a large finite
          // value so the controls still appear.
          setPos(86400);
        }
      } else {
        navigator.mediaSession.setPositionState();
      }
    } catch {
      // setPositionState unsupported or rejected; controls may still show.
    }
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
