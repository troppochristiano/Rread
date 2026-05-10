// Each chunk is sent to the TTS engine as one utterance, so chunk = sentence
// gives the engine a complete prosodic unit to shape (rising/falling intonation,
// final pause, etc.). Splitting mid-sentence loses that — the engine treats
// each fragment as its own complete thought and the result sounds chopped.
const MAX_CHUNK = 500;

// Honorifics/titles whose trailing period must not trigger a sentence split.
// These are always followed by a capitalized name, which would otherwise fool
// the uppercase lookahead in SENTENCE_BOUNDARY.
const ABBREV_RE = /\b(Dr|Dott|Sig|Ing|Prof|Gen|Col|Mr|Mrs|Ms|Sr|Jr)\./g;
const PLACEHOLDER = '\x00';

function restore(text) {
  return text.replace(/\x00/g, '.');
}

// Sentence-ending punctuation followed by whitespace + uppercase/opening quote.
const SENTENCE_BOUNDARY = /(?<=[.!?…]["']?)\s+(?=[A-Z"'«"'])/g;

// When a single sentence exceeds MAX_CHUNK, fall back to breaking at the most
// prose-natural pause point available, preferring breaks that themselves carry
// sentence-like prosody (semicolon, em-dash) over weaker pauses (colon, comma).
// The first separator that produces ≥2 parts wins, then we greedily pack parts
// up to MAX_CHUNK.
function subSplit(piece) {
  if (piece.length <= MAX_CHUNK) return [piece];

  for (const sep of [/(?<=;)\s*/g, /(?<=—)\s*/g, /(?<=:)\s*/g, /(?<=,)\s*/g, /\s+/g]) {
    const parts = piece.split(sep);
    if (parts.length < 2) continue;

    const result = [];
    let current = '';
    for (const part of parts) {
      const candidate = current ? current + ' ' + part : part;
      if (candidate.length <= MAX_CHUNK) {
        current = candidate;
      } else {
        if (current) result.push(current.trim());
        current = part;
      }
    }
    if (current.trim()) result.push(current.trim());
    if (result.length > 1) return result;
  }

  return [piece];
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

    for (const sentence of sentences) {
      if (sentence.length <= MAX_CHUNK) {
        chunks.push(sentence);
      } else {
        chunks.push(...subSplit(sentence));
      }
    }
  }

  return chunks.filter(s => s.trim());
}
