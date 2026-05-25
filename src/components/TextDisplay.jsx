import { useRef, useEffect, useState, forwardRef, memo, useMemo, useSyncExternalStore } from "react";

function tokenize(text) {
  const tokens = [];
  const regex = /(\S+|\s+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    tokens.push({ text: match[0], start: match.index });
  }
  return tokens;
}

const CurrentChunk = forwardRef(function CurrentChunk(
  { text, chunkIndex, subscribeWordIndex, getWordIndex },
  ref,
) {
  const wordIndex = useSyncExternalStore(subscribeWordIndex, getWordIndex);
  const tokens = useMemo(() => tokenize(text), [text]);

  // Highlight the last word whose start <= wordIndex rather than checking
  // whether wordIndex falls inside the token's range. This prevents short
  // words from being skipped when the estimator ticks jump over their range.
  let activeIdx = -1;
  for (let j = 0; j < tokens.length; j++) {
    if (/\S/.test(tokens[j].text) && tokens[j].start <= wordIndex) {
      activeIdx = j;
    }
  }

  return (
    <span className="chunk-current" ref={ref}>
      {tokens.map((token, j) => {
        const isWord = /\S/.test(token.text);
        if (!isWord) return <span key={j}>{token.text}</span>;
        return (
          <span
            key={j}
            className={`word-clickable${j === activeIdx ? " word-active" : ""}`}
            data-chunk={chunkIndex}
            data-offset={token.start}
          >
            {token.text}
          </span>
        );
      })}
    </span>
  );
});

const PlainChunk = memo(function PlainChunk({ text, className, chunkIndex }) {
  return (
    <span
      className={`${className} chunk-plain`}
      data-chunk={chunkIndex}
      data-offset={0}
    >
      {text}
    </span>
  );
});

// Like CurrentChunk but without the moving word highlight — used for the
// non-leading chunks in an active batch (cloud voices) so each word stays
// individually clickable to seek into.
const BatchChunk = memo(function BatchChunk({ text, chunkIndex }) {
  const tokens = useMemo(() => tokenize(text), [text]);
  return (
    <span className="chunk-current">
      {tokens.map((token, j) => {
        const isWord = /\S/.test(token.text);
        if (!isWord) return <span key={j}>{token.text}</span>;
        return (
          <span
            key={j}
            className="word-clickable"
            data-chunk={chunkIndex}
            data-offset={token.start}
          >
            {token.text}
          </span>
        );
      })}
    </span>
  );
});

export default function TextDisplay({
  chunks,
  chunkIndex,
  batchEndIndex,
  subscribeWordIndex,
  getWordIndex,
  scrollTrigger,
  scrollBump,
  isPlaying,
  rate,
  seekTo,
  onCenterActive,
  t,
}) {
  const containerRef = useRef(null);
  const activeRef = useRef(null);
  // Set when the user explicitly scrolls (wheel/touch/keys). Cleared only on
  // explicit re-focus triggers (play, 3-dots, Sync button) — sentence/batch
  // boundary changes no longer reset it, so user scroll is sticky.
  const userScrolledRef = useRef(false);
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  // 'in' | 'above' | 'below' — where the active chunk sits relative to the
  // visible portion of the scroll container. Drives the Sync arrow direction.
  const [activePosition, setActivePosition] = useState("in");
  const prevExplicitRef = useRef({ scrollTrigger, scrollBump });
  // Anchors the tracking-scroll curve to the moment the current batch began.
  // Keyed by batch identity so 3-dots / scroll-bump re-runs keep the original
  // start time and resume scrolling from where the curve would be by now.
  const batchAnchorRef = useRef({ key: "", animStart: 0 });

  const showSync = userHasScrolled && activePosition !== "in";

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onUserScroll = () => {
      userScrolledRef.current = true;
      setUserHasScrolled(true);
    };
    container.addEventListener("wheel", onUserScroll, { passive: true });
    container.addEventListener("touchmove", onUserScroll, { passive: true });
    container.addEventListener("keydown", onUserScroll);
    return () => {
      container.removeEventListener("wheel", onUserScroll);
      container.removeEventListener("touchmove", onUserScroll);
      container.removeEventListener("keydown", onUserScroll);
    };
  }, []);

  // Track where the active chunk sits relative to the viewport — re-checks
  // on scroll and when the active chunk changes. IntersectionObserver isn't
  // enough here because it only fires on boundary crossings, not direction.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const el = activeRef.current;
      if (!el) return;
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      if (eRect.bottom < cRect.top) setActivePosition("above");
      else if (eRect.top > cRect.bottom) setActivePosition("below");
      else setActivePosition("in");
    };
    update();
    container.addEventListener("scroll", update, { passive: true });
    return () => container.removeEventListener("scroll", update);
  }, [chunkIndex]);

  function handleSync() {
    // Mirror the 3-dots "go to highlighted" path so the scroll effect's
    // explicit-refocus branch handles centering + re-engaging tracking.
    if (onCenterActive) onCenterActive();
  }

  // Auto-scroll: bring active chunk to ~28% from top, then for cloud-voice
  // batches that overflow the viewport, smoothly track through the batch
  // over its estimated duration so the reader can follow along.
  useEffect(() => {
    const explicitRefocus =
      scrollTrigger !== prevExplicitRef.current.scrollTrigger ||
      scrollBump !== prevExplicitRef.current.scrollBump;
    prevExplicitRef.current = { scrollTrigger, scrollBump };

    if (explicitRefocus) {
      userScrolledRef.current = false;
      setUserHasScrolled(false);
    }
    // Once the user has scrolled away, sentence/batch changes no longer drag
    // the view — the Sync button takes over.
    if (userScrolledRef.current) return;

    const container = containerRef.current;
    const el = activeRef.current;
    if (!container || !el) return;

    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const relativeTop = elRect.top - containerRect.top + container.scrollTop;
    const containerH = container.clientHeight;
    const startScroll = Math.max(0, relativeTop - containerH * 0.28);

    let initialScroll = startScroll;
    let tracking = null;

    if (isPlaying && batchEndIndex > chunkIndex && chunks) {
      const endEl = container.querySelector(`[data-chunk="${batchEndIndex}"]`);
      if (endEl) {
        const endRect = endEl.getBoundingClientRect();
        const endBottom = endRect.bottom - containerRect.top + container.scrollTop;
        const endScroll = Math.max(startScroll, endBottom - containerH * 0.72);
        if (endScroll > startScroll + 8) {
          let totalChars = 0;
          for (let i = chunkIndex; i <= batchEndIndex; i++) {
            totalChars += (chunks[i] || "").length;
          }
          // ~18 chars/sec at rate=1 is a reasonable cross-voice average for
          // English cloud voices; only approximate since they give no
          // progress info.
          const charsPerSec = 18 * Math.max(0.1, rate || 1);
          const durationMs = (totalChars / charsPerSec) * 1000;

          // Same audio segment → keep the original animStart so 3-dots /
          // play-resume snap-backs land at the position the autoscroller
          // would have reached by now.
          const batchKey = `${chunkIndex}-${batchEndIndex}-${scrollTrigger}`;
          if (batchAnchorRef.current.key !== batchKey) {
            batchAnchorRef.current = { key: batchKey, animStart: performance.now() };
          }
          const animStart = batchAnchorRef.current.animStart;
          const elapsed = Math.max(0, performance.now() - animStart);
          const initialT = Math.min(1, elapsed / durationMs);
          initialScroll = startScroll + (endScroll - startScroll) * initialT;

          tracking = { animStart, durationMs, startScroll, endScroll };
        }
      }
    }

    container.scrollTo({ top: initialScroll, behavior: "smooth" });
    if (!tracking) return;

    // Delay so the initial smooth scroll can settle before we take over with
    // direct scrollTop writes (uses wall time, not the animStart anchor).
    const tickStartTime = performance.now() + 400;
    let rafId = requestAnimationFrame(function tick(now) {
      if (userScrolledRef.current) return;
      if (now < tickStartTime) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      const t = Math.min(1, (now - tracking.animStart) / tracking.durationMs);
      container.scrollTop = tracking.startScroll + (tracking.endScroll - tracking.startScroll) * t;
      if (t < 1) rafId = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(rafId);
  }, [chunkIndex, batchEndIndex, scrollTrigger, scrollBump, isPlaying, rate, chunks]);

  // Single delegated click handler — reads data attrs from the clicked word.
  function handleClick(e) {
    const target = e.target.closest("[data-offset]");
    if (!target) return;
    const ci = Number(target.dataset.chunk);
    const off = Number(target.dataset.offset);
    if (Number.isFinite(ci) && Number.isFinite(off)) {
      seekTo(ci, off);
    }
  }

  return (
    <div className="text-display-wrap">
      <div className="text-display" ref={containerRef}>
        <div className="text-content" onClick={handleClick}>
          {chunks.map((chunk, i) => {
            const isPast = i < chunkIndex;
            const isCurrent = i === chunkIndex;
            // Cloud voices (no boundary events) highlight the whole batch
            // [chunkIndex..batchEndIndex] as a single block.
            const isInBatch = i > chunkIndex && i <= (batchEndIndex ?? chunkIndex);
            const plainClassName = isPast ? "chunk-past" : "chunk-future";

            return (
              <div key={i} className="chunk-row">
                {isCurrent ? (
                  <CurrentChunk
                    ref={activeRef}
                    text={chunk}
                    chunkIndex={i}
                    subscribeWordIndex={subscribeWordIndex}
                    getWordIndex={getWordIndex}
                  />
                ) : isInBatch ? (
                  <BatchChunk text={chunk} chunkIndex={i} />
                ) : (
                  <PlainChunk
                    text={chunk}
                    className={plainClassName}
                    chunkIndex={i}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {showSync && (
        <button
          className="sync-fab"
          onClick={handleSync}
          aria-label={t?.sync ?? "Sync"}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14"/>
            {activePosition === "above" ? (
              <path d="M5 12l7-7 7 7"/>
            ) : (
              <path d="M19 12l-7 7-7-7"/>
            )}
          </svg>
          <span>{t?.sync ?? "Sync"}</span>
        </button>
      )}
    </div>
  );
}
