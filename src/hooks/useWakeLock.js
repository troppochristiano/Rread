import { useEffect, useRef } from "react";

// Keep the screen awake while speech is playing — Android only.
//
// On Android, Chrome blanks the screen on the normal display timeout even while
// audio plays; once the screen is off the page is throttled/suspended and
// playback stalls. The Screen Wake Lock API prevents the screen from dimming
// off. We deliberately scope this to Android: iOS Safari does not support the
// API, and on desktop a reader app holding the display on indefinitely is
// undesirable.
const isAndroid =
  typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

export function useWakeLock(isPlaying) {
  const sentinelRef = useRef(null);

  useEffect(() => {
    if (!isAndroid) return;
    if (!("wakeLock" in navigator)) return;

    let cancelled = false;

    const acquire = async () => {
      if (cancelled || sentinelRef.current) return;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        // The browser auto-releases the lock when the tab is hidden; clear our
        // ref so the visibilitychange handler can re-acquire it on return.
        sentinel.addEventListener("release", () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
        });
      } catch {
        // Lock can be rejected (e.g. low battery, not visible); ignore.
      }
    };

    const release = () => {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel) sentinel.release().catch(() => {});
    };

    // A wake lock is dropped whenever the page is hidden, so re-request it when
    // we become visible again while still playing.
    const onVisibility = () => {
      if (document.visibilityState === "visible" && isPlaying) acquire();
    };

    if (isPlaying) {
      acquire();
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [isPlaying]);
}
