// Lightweight, dependency-free language detection.
//
// Strategy:
//   1. Non-Latin scripts are detected by Unicode range (fast + reliable).
//   2. Latin-script languages are scored by counting common stopwords.
// Returns a base language code (e.g. "it", "en", "ru") or null when the
// text is too short / ambiguous to make a confident guess.

// Stopwords are short, high-frequency function words. We only need a handful
// per language: matching even a few in a sentence is a strong signal.
const STOPWORDS = {
  it: ["il", "lo", "la", "che", "di", "e", "un", "una", "per", "non", "con", "sono", "del", "della", "anche", "come", "più", "questo", "ma", "se"],
  en: ["the", "and", "of", "to", "in", "is", "that", "it", "for", "was", "with", "you", "this", "but", "not", "are", "have", "from", "they", "his"],
  es: ["el", "la", "los", "las", "de", "que", "y", "un", "una", "por", "con", "para", "no", "es", "se", "lo", "como", "más", "pero", "su"],
  fr: ["le", "la", "les", "de", "des", "et", "un", "une", "que", "qui", "pour", "pas", "dans", "est", "sur", "plus", "avec", "ne", "ce", "vous"],
  de: ["der", "die", "das", "und", "ist", "ein", "eine", "nicht", "mit", "den", "von", "zu", "auch", "auf", "für", "sich", "dem", "im", "dass", "es"],
  pt: ["o", "a", "os", "as", "de", "que", "e", "um", "uma", "por", "com", "para", "não", "é", "se", "do", "da", "como", "mais", "mas"],
  nl: ["de", "het", "een", "en", "van", "dat", "is", "in", "te", "niet", "die", "op", "met", "voor", "aan", "ook", "maar", "om", "dan", "zijn"],
  sv: ["och", "att", "det", "som", "en", "på", "är", "av", "för", "med", "den", "till", "inte", "har", "de", "ett", "om", "men", "var", "jag"],
  pl: ["i", "w", "na", "się", "z", "że", "do", "nie", "to", "jest", "co", "jak", "po", "ale", "od", "tak", "czy", "który", "być", "by"],
  ru: ["и", "в", "не", "на", "что", "с", "по", "это", "как", "а", "то", "все", "она", "так", "его", "но", "да", "ты", "к", "у"],
};

const SCRIPT_RANGES = [
  { lang: "ja", re: /[぀-ヿ]/ },              // hiragana / katakana
  { lang: "ko", re: /[가-힣ᄀ-ᇿ]/ }, // hangul
  { lang: "zh", re: /[一-鿿]/ },              // CJK ideographs (after kana)
  { lang: "el", re: /[Ͱ-Ͽ]/ },              // greek
  { lang: "he", re: /[֐-׿]/ },              // hebrew
  { lang: "ar", re: /[؀-ۿ]/ },              // arabic
  { lang: "hi", re: /[ऀ-ॿ]/ },              // devanagari
  { lang: "th", re: /[฀-๿]/ },              // thai
  { lang: "ru", re: /[Ѐ-ӿ]/ },              // cyrillic
];

// Build a Set per language once for O(1) lookups.
const STOPWORD_SETS = Object.fromEntries(
  Object.entries(STOPWORDS).map(([lang, words]) => [lang, new Set(words)]),
);

/**
 * Detect the dominant language of `text`.
 * @returns {string|null} base language code or null if undetermined.
 */
export function detectLanguage(text) {
  const sample = (text || "").slice(0, 4000).trim();
  if (sample.length < 12) return null;

  // 1. Non-Latin scripts win immediately — except CJK ideographs, which we
  //    only treat as Chinese when no kana is present (otherwise it's Japanese).
  for (const { lang, re } of SCRIPT_RANGES) {
    if (re.test(sample)) return lang;
  }

  // 2. Stopword scoring for Latin-script languages.
  const tokens = sample
    .toLowerCase()
    .match(/[\p{L}]+/gu);
  if (!tokens || tokens.length < 3) return null;

  const scores = {};
  for (const lang of Object.keys(STOPWORD_SETS)) scores[lang] = 0;
  for (const tok of tokens) {
    for (const [lang, set] of Object.entries(STOPWORD_SETS)) {
      if (set.has(tok)) scores[lang]++;
    }
  }

  let best = null;
  let bestScore = 0;
  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = lang;
    }
  }

  // Require a minimum density of stopword hits to avoid false positives on
  // short or unusual text.
  const ratio = bestScore / tokens.length;
  if (best && (bestScore >= 2 || ratio >= 0.15)) return best;
  return null;
}
