// Chunks (paragraph-sized — the unit of display/seek/highlight) get batched
// into larger utterances at speak-time. Each utterance carries an end-of-
// utterance silence the engine inserts on its own (~150-300ms), which is the
// audible "gap" between chunks. Batching collapses N gaps into 1. 1500 is
// comfortable for all engines tested without losing `onboundary` accuracy.
// Paragraphs longer than this are split internally at sentence boundaries
// while remaining a single display chunk.
export const MAX_UTTERANCE_CHARS = 1500;

// Find a natural break point ≤ maxLen for splitting an oversized paragraph
// across utterances. Prefers sentence boundaries, then weaker pauses, then
// whitespace. Falls back to a hard cut at maxLen if nothing else fits.
export function findUtteranceBreak(text, maxLen) {
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
