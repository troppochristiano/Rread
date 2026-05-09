// Splits text into one chunk per sentence.
// Treats line breaks as hard boundaries, then splits each line on sentence
// punctuation. Long sentences (>250 chars) are sub-split on commas to stay
// within Chrome's per-utterance limit.
export function splitIntoSentences(text) {
  if (!text || !text.trim()) return [];

  // Hard split on any newline run — line/paragraph breaks always end a chunk
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);

  const sentences = [];
  for (const line of lines) {
    const parts = line
      .split(/(?<=[.!?…])\s+/)
      .map(s => s.trim())
      .filter(Boolean);
    sentences.push(...parts);
  }

  // Sub-split long sentences on commas
  const result = [];
  for (const s of sentences) {
    if (s.length <= 250) {
      result.push(s);
      continue;
    }
    const parts = s.split(/,\s*/);
    let sub = '';
    for (const part of parts) {
      const candidate = sub ? sub + ', ' + part : part;
      if (candidate.length <= 250) {
        sub = candidate;
      } else {
        if (sub) result.push(sub);
        sub = part;
      }
    }
    if (sub) result.push(sub);
  }

  return result.filter(s => s.trim());
}
