import { MAX_UTTERANCE_CHARS, findUtteranceBreak } from './utteranceBatch.js';

const ABBREV_RE = /\b(Dr|Dott|Sig|Ing|Prof|Gen|Col|Mr|Mrs|Ms|Sr|Jr)\./g;
const PLACEHOLDER = '\x00';

function restore(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x00/g, '.');
}

const SENTENCE_BOUNDARY = /(?<=[.!?…]["']?)\s+(?=[A-Z"'«"'])/g;

export function splitIntoParagraphs(text) {
  if (!text || !text.trim()) return [];
  return text.split(/\n+/).map(p => p.trim()).filter(Boolean);
}

export function splitIntoSentences(text) {
  if (!text || !text.trim()) return [];

  const chunks = [];
  const paragraphs = text.split(/\n+/).map(l => l.trim()).filter(Boolean);

  for (const para of paragraphs) {
    SENTENCE_BOUNDARY.lastIndex = 0;
    const sentences = para
      .replace(ABBREV_RE, (_, w) => w + PLACEHOLDER)
      .split(SENTENCE_BOUNDARY)
      .map(s => restore(s).trim())
      .filter(Boolean);

    chunks.push(...sentences);
  }

  return chunks.filter(s => s.trim());
}

// Pack sentences into utterance-sized batches using the same greedy algorithm
// as buildBatch in useSpeech.js. Each returned string is exactly what one
// SpeechSynthesisUtterance will receive, so display chunks == speech utterances.
export function buildUtteranceChunks(text) {
  const sentences = splitIntoSentences(text);
  if (!sentences.length) return [];

  const utterances = [];
  let i = 0;

  while (i < sentences.length) {
    const first = sentences[i];

    if (first.length > MAX_UTTERANCE_CHARS) {
      let offset = 0;
      while (offset < first.length) {
        const remaining = first.slice(offset);
        if (remaining.length <= MAX_UTTERANCE_CHARS) {
          utterances.push(remaining.trim());
          break;
        }
        const splitAt = findUtteranceBreak(remaining, MAX_UTTERANCE_CHARS);
        utterances.push(remaining.slice(0, splitAt).trimEnd());
        offset += splitAt;
      }
      i++;
      continue;
    }

    let batch = first;
    i++;

    while (i < sentences.length) {
      const next = sentences[i];
      if (next.length > MAX_UTTERANCE_CHARS) break;
      if (batch.length + 1 + next.length > MAX_UTTERANCE_CHARS) break;
      batch = batch + ' ' + next;
      i++;
    }

    utterances.push(batch);
  }

  return utterances;
}
