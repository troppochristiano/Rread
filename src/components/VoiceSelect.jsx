import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { detectLanguage } from "../utils/detectLanguage";

const LANG_NAMES = new Intl.DisplayNames([navigator.language, "en"], {
  type: "language",
});

const FAVORITES_KEY = "tts_voice_favorites";

function voiceKey(v) {
  return `${v.voiceURI || v.name}|${v.lang}`;
}

function loadFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(set) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set]));
  } catch {
    // ignore quota errors
  }
}

// Android reports locale tags with underscores (Java Locale.toString(), e.g.
// "en_US", "it_IT"); desktop and iOS use BCP-47 hyphens ("en-US"). Normalize
// so grouping by base language and Intl.DisplayNames labels work everywhere.
function normalizeLang(lang) {
  return lang.replace(/_/g, "-");
}

function baseLang(lang) {
  return normalizeLang(lang).split("-")[0].toLowerCase();
}

function getLangLabel(tag) {
  try {
    return LANG_NAMES.of(normalizeLang(tag));
  } catch {
    return tag;
  }
}

function groupVoicesByLang(voices) {
  const deviceLang = navigator.language.split("-")[0].toLowerCase();
  const map = new Map();
  for (const v of voices) {
    const base = baseLang(v.lang);
    if (!map.has(base)) map.set(base, []);
    map.get(base).push(v);
  }
  const keys = [...map.keys()];
  const priority = [deviceLang, "en"].filter((l, i, a) => a.indexOf(l) === i);
  const rest = keys.filter((k) => !priority.includes(k)).sort();
  const ordered = [...priority.filter((k) => map.has(k)), ...rest];
  return ordered.map((base) => ({
    base,
    label: getLangLabel(base),
    voices: map.get(base),
  }));
}

function IconStar({ filled }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 12 12"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    >
      <path d="M6 1.2l1.45 2.94 3.25.47-2.35 2.29.55 3.24L6 8.61 3.1 10.14l.55-3.24L1.3 4.61l3.25-.47L6 1.2z" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg
      width="10"
      height="7"
      viewBox="0 0 12 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M1 1l5 5 5-5" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    >
      <circle cx="6" cy="6" r="4.2" />
      <path d="M9.2 9.2L12.5 12.5" />
    </svg>
  );
}

function IconSparkle() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <path d="M6 0l1.1 3.3L10.5 4.5 7.1 5.6 6 9 4.9 5.6 1.5 4.5l3.4-1.2L6 0zM10.5 7.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5z" />
    </svg>
  );
}

function matchesQuery(v, label, q) {
  return (
    label.toLowerCase().includes(q) ||
    v.name.toLowerCase().includes(q) ||
    normalizeLang(v.lang).toLowerCase().includes(q)
  );
}

export default function VoiceSelect({ voices, selectedVoice, setSelectedVoice, text = "", t }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestedOpen, setSuggestedOpen] = useState(true);
  const [favorites, setFavorites] = useState(loadFavorites);
  const rootRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);

  const allGroups = useMemo(() => groupVoicesByLang(voices), [voices]);

  // Smart suggestion: detect the text language and surface matching voices.
  const suggestedBase = useMemo(() => detectLanguage(text), [text]);
  const suggestedGroup = suggestedBase
    ? allGroups.find((g) => g.base === suggestedBase) || null
    : null;

  const q = query.trim().toLowerCase();
  const groups = q
    ? allGroups
        .map((g) => ({
          ...g,
          voices: g.voices.filter((v) => matchesQuery(v, g.label, q)),
        }))
        .filter((g) => g.voices.length > 0)
    : allGroups;

  const favoriteVoices = voices.filter(
    (v) =>
      favorites.has(voiceKey(v)) &&
      (!q || matchesQuery(v, getLangLabel(baseLang(v.lang)), q)),
  );

  const hasResults = groups.length > 0 || favoriteVoices.length > 0;

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const toggleFavorite = useCallback((v) => {
    const key = voiceKey(v);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveFavorites(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) closeDropdown();
    }
    function onKey(e) {
      if (e.key === "Escape") closeDropdown();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, closeDropdown]);

  useEffect(() => {
    if (!open || !dropdownRef.current) return;
    dropdownRef.current.scrollTop = 0;
  }, [open]);

  // Focus the search input on open, but not on touch devices: focusing there
  // pops up the on-screen keyboard, which covers the language list.
  useEffect(() => {
    if (!open || !searchRef.current) return;
    const isTouch = window.matchMedia?.("(pointer: coarse)").matches;
    if (isTouch) return;
    searchRef.current.focus();
  }, [open]);

  const selectedKey = selectedVoice ? voiceKey(selectedVoice) : "";
  const triggerLabel = selectedVoice
    ? `${selectedVoice.name} (${normalizeLang(selectedVoice.lang)})`
    : t.voice;

  function selectVoice(v) {
    setSelectedVoice(v);
    closeDropdown();
  }

  function renderOption(v, keyPrefix) {
    const k = voiceKey(v);
    const isSelected = k === selectedKey;
    const isFav = favorites.has(k);
    return (
      <div
        key={keyPrefix + k}
        className={`voice-option ${isSelected ? "selected" : ""}`}
        role="option"
        aria-selected={isSelected}
      >
        <button
          type="button"
          className="voice-option-label"
          onClick={() => selectVoice(v)}
        >
          {v.name} ({normalizeLang(v.lang)})
        </button>
        <button
          type="button"
          className={`voice-option-star ${isFav ? "active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(v);
          }}
          title={isFav ? t.removeFavorite : t.addFavorite}
          aria-label={isFav ? t.removeFavorite : t.addFavorite}
          aria-pressed={isFav}
        >
          <IconStar filled={isFav} />
        </button>
      </div>
    );
  }

  return (
    <div className="voice-select-wrap" ref={rootRef}>
      <button
        type="button"
        className={`voice-select-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t.voice}
      >
        <span className="voice-select-trigger-label">{triggerLabel}</span>
        <IconChevron />
      </button>
      {open && (
        <div className="voice-dropdown" ref={dropdownRef} role="listbox">
          <div className="voice-search">
            <IconSearch />
            <input
              ref={searchRef}
              type="text"
              className="voice-search-input"
              placeholder={t.searchLang}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t.searchLang}
            />
          </div>

          {!q && suggestedGroup && (
            <div className="voice-group voice-group--suggested">
              <button
                type="button"
                className={`voice-group-label voice-group-label--suggested ${suggestedOpen ? "open" : ""}`}
                onClick={() => setSuggestedOpen((o) => !o)}
                aria-expanded={suggestedOpen}
              >
                <IconSparkle />
                <span className="voice-suggested-text">
                  {t.suggestedLang(suggestedGroup.label)}
                </span>
                <IconChevron />
              </button>
              {suggestedOpen &&
                suggestedGroup.voices.map((v) => renderOption(v, "sug-"))}
            </div>
          )}

          {favoriteVoices.length > 0 && (
            <div className="voice-group">
              <div className="voice-group-label">{t.favorites}</div>
              {favoriteVoices.map((v) => renderOption(v, "fav-"))}
            </div>
          )}
          {groups.map(({ base, label, voices: groupVoices }) => (
            <div key={base} className="voice-group">
              <div className="voice-group-label">{label}</div>
              {groupVoices.map((v) => renderOption(v, ""))}
            </div>
          ))}

          {!hasResults && <div className="voice-no-results">{t.noVoiceResults}</div>}
        </div>
      )}
    </div>
  );
}
