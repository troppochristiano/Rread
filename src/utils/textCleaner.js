// Maps a code point in U+1D400–U+1D7FF (Unicode Mathematical Alphanumerics) to ASCII.
// These styled characters are commonly used on LinkedIn/Twitter for "bold" or "italic" text.
function mapMathAlphanumeric(cp) {
  // Each style block: 26 uppercase (A-Z) followed by 26 lowercase (a-z), 52 chars per block.
  // The first block starts at 0x1D400.
  const letterBlockStarts = [
    0x1D400, // Mathematical Bold
    0x1D434, // Mathematical Italic
    0x1D468, // Mathematical Bold Italic
    0x1D49C, // Mathematical Script
    0x1D4D0, // Mathematical Bold Script
    0x1D504, // Mathematical Fraktur
    0x1D538, // Mathematical Double-struck
    0x1D56C, // Mathematical Bold Fraktur
    0x1D5A0, // Mathematical Sans-serif
    0x1D5D4, // Mathematical Sans-serif Bold
    0x1D608, // Mathematical Sans-serif Italic
    0x1D63C, // Mathematical Sans-serif Bold Italic
    0x1D670, // Mathematical Monospace
  ];

  for (const start of letterBlockStarts) {
    const pos = cp - start;
    if (pos >= 0 && pos < 52) {
      return pos < 26
        ? String.fromCharCode(65 + pos)       // A-Z
        : String.fromCharCode(97 + pos - 26); // a-z
    }
  }

  // Digit blocks: Bold, Double-struck, Sans-serif, Sans-serif Bold, Monospace
  const digitBlockStarts = [0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6];
  for (const start of digitBlockStarts) {
    const pos = cp - start;
    if (pos >= 0 && pos <= 9) {
      return String.fromCharCode(48 + pos); // 0-9
    }
  }

  return null;
}

function normalizeMathUnicode(str) {
  const result = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1D400 && cp <= 0x1D7FF) {
      const mapped = mapMathAlphanumeric(cp);
      result.push(mapped !== null ? mapped : ch);
    } else {
      result.push(ch);
    }
  }
  return result.join('');
}

export function cleanTextForSpeech(text) {
  if (!text) return '';

  let t = normalizeMathUnicode(text);

  // HTML tags
  t = t.replace(/<[^>]+>/g, ' ');

  // Fenced code blocks
  t = t.replace(/```[\s\S]*?```/g, '');

  // Inline code
  t = t.replace(/`[^`]+`/g, '');

  // Markdown links — keep label text
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Images
  t = t.replace(/!\[[^\]]*\]\([^)]+\)/g, '');

  // Headers
  t = t.replace(/^#{1,6}\s+/gm, '');

  // Blockquotes
  t = t.replace(/^>\s*/gm, '');

  // Horizontal rules
  t = t.replace(/^[-*_]{3,}\s*$/gm, '');

  // Bold/italic (order matters: triple before double before single)
  t = t.replace(/\*{3}([^*]+)\*{3}/g, '$1');
  t = t.replace(/_{3}([^_]+)_{3}/g, '$1');
  t = t.replace(/\*{2}([^*]+)\*{2}/g, '$1');
  t = t.replace(/_{2}([^_]+)_{2}/g, '$1');
  t = t.replace(/\*([^*]+)\*/g, '$1');
  t = t.replace(/_([^_]+)_/g, '$1');

  // Strikethrough
  t = t.replace(/~~([^~]+)~~/g, '$1');

  // List markers
  t = t.replace(/^[ \t]*[-•*+]\s+/gm, '');
  t = t.replace(/^[ \t]*\d+\.\s+/gm, '');

  // Table pipes
  t = t.replace(/\|/g, ' ');

  // Remaining markdown symbols
  t = t.replace(/[*_~`]/g, '');

  // Collapse whitespace
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.replace(/[ \t]+/g, ' ');

  return t.trim();
}
