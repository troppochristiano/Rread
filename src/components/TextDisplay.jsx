import { useRef, useEffect, forwardRef, memo } from "react";

// Number of chunks around the current one that get full per-word tokenization.
// Chunks outside this window render as a single span (per-chunk click only).
const TOKENIZE_WINDOW = 30;

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
  { text, wordIndex, chunkIndex },
  ref,
) {
  const tokens = tokenize(text);

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

const TokenizedChunk = memo(function TokenizedChunk({
  text,
  className,
  chunkIndex,
}) {
  const tokens = tokenize(text);
  return (
    <span className={className}>
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
      })}{" "}
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
      {text}{" "}
    </span>
  );
});

export default function TextDisplay({
  chunks,
  chunkIndex,
  wordIndex,
  scrollTrigger,
  seekTo,
}) {
  const containerRef = useRef(null);
  const activeRef = useRef(null);
  const seekToRef = useRef(seekTo);
  seekToRef.current = seekTo;

  // Auto-scroll: bring active chunk to ~28% from top of container
  useEffect(() => {
    const container = containerRef.current;
    const el = activeRef.current;
    if (!container || !el) return;

    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const relativeTop = elRect.top - containerRect.top + container.scrollTop;
    const target = relativeTop - container.clientHeight * 0.28;
    container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [chunkIndex, scrollTrigger]);

  // Single delegated click handler — reads data attrs from the clicked word.
  function handleClick(e) {
    const target = e.target.closest("[data-offset]");
    if (!target) return;
    const ci = Number(target.dataset.chunk);
    const off = Number(target.dataset.offset);
    if (Number.isFinite(ci) && Number.isFinite(off)) {
      seekToRef.current(ci, off);
    }
  }

  return (
    <div className="text-display" ref={containerRef}>
      <div className="text-content" onClick={handleClick}>
        {chunks.map((chunk, i) => {
          const isPast = i < chunkIndex;
          const isCurrent = i === chunkIndex;
          const inWindow = Math.abs(i - chunkIndex) <= TOKENIZE_WINDOW;
          const className = isPast ? "chunk-past" : "chunk-future";

          if (isCurrent) {
            return (
              <span key={i}>
                <CurrentChunk
                  ref={activeRef}
                  text={chunk}
                  wordIndex={wordIndex}
                  chunkIndex={i}
                />{" "}
              </span>
            );
          }

          if (inWindow) {
            return (
              <TokenizedChunk
                key={i}
                text={chunk}
                className={className}
                chunkIndex={i}
              />
            );
          }

          return (
            <PlainChunk
              key={i}
              text={chunk}
              className={className}
              chunkIndex={i}
            />
          );
        })}
      </div>
    </div>
  );
}
