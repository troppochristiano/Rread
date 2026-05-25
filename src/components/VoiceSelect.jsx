import { useEffect, useRef, useState, useCallback } from "react";

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

function getLangLabel(tag) {
  try {
    return LANG_NAMES.of(tag);
  } catch {
    return tag;
  }
}

function groupVoicesByLang(voices) {
  const deviceLang = navigator.language.split("-")[0].toLowerCase();
  const map = new Map();
  for (const v of voices) {
    const base = v.lang.split("-")[0].toLowerCase();
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

export default function VoiceSelect({ voices, selectedVoice, setSelectedVoice, t }) {
  const [open, setOpen] = useState(false);
  const [favorites, setFavorites] = useState(loadFavorites);
  const rootRef = useRef(null);
  const dropdownRef = useRef(null);

  const favoriteVoices = voices.filter((v) => favorites.has(voiceKey(v)));
  const groups = groupVoicesByLang(voices);

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
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !dropdownRef.current) return;
    const el = dropdownRef.current.querySelector(".voice-option.selected");
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [open]);

  const selectedKey = selectedVoice ? voiceKey(selectedVoice) : "";
  const triggerLabel = selectedVoice
    ? `${selectedVoice.name} (${selectedVoice.lang})`
    : t.voice;

  function selectVoice(v) {
    setSelectedVoice(v);
    setOpen(false);
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
          {v.name} ({v.lang})
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
        </div>
      )}
    </div>
  );
}
