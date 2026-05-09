const MAX_CHUNK = 200;
const MIN_CHUNK = 25; // fragments shorter than this merge with the next clause

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

// Intra-sentence pause points: comma, semicolon, colon, em-dash.
// Splitting here gives the TTS voice its natural rhythm — each clause becomes
// its own utterance and the trailing punctuation drives the intonation.
const CLAUSE_BOUNDARY = /(?<=[,;:—])\s+/g;

// Sub-split a single oversized clause/sentence at the most natural pause
// point available. Used only when one clause exceeds MAX_CHUNK on its own.
function subSplit(piece) {
  if (piece.length <= MAX_CHUNK) return [piece];

  for (const sep of [/(?<=—)\s*/g, /(?<=:)\s*/g, /(?<=;)\s*/g, /(?<=,)\s*/g, /\s+/g]) {
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

    let current = '';

    for (const sentence of sentences) {
      // Split the sentence into clauses at commas/semicolons/colons/em-dashes
      // so each natural pause point becomes a chunk boundary.
      const rawClauses = sentence.split(CLAUSE_BOUNDARY);

      // Any oversized clause gets sub-split first so we can run the same
      // accumulation loop over uniformly-sized pieces.
      const clauses = [];
      for (const c of rawClauses) {
        if (c.length > MAX_CHUNK) clauses.push(...subSplit(c));
        else clauses.push(c);
      }

      for (const clause of clauses) {
        // Never accumulate across ? or ! — TTS engines need those at the end
        // of the utterance to apply question/exclamation intonation.
        const endsInIntonation = /[?!]["']?$/.test(current);

        if (!current) {
          current = clause;
        } else if (current.length < MIN_CHUNK && !endsInIntonation) {
          // Tiny fragment — merge with the next clause rather than emit alone
          const candidate = current + ' ' + clause;
          if (candidate.length <= MAX_CHUNK) {
            current = candidate;
          } else {
            chunks.push(current);
            current = clause;
          }
        } else {
          // Each clause gets its own chunk so the trailing punctuation
          // (comma, period, question mark, etc.) shapes the intonation.
          chunks.push(current);
          current = clause;
        }
      }
    }

    if (current) chunks.push(current);
  }

  return chunks.filter(s => s.trim());
}
