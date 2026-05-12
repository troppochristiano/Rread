import { useEffect, useRef, useState } from "react";

const LANG_NAMES = new Intl.DisplayNames([navigator.language, "en"], {
  type: "language",
});

function getLangLabel(langTag) {
  try {
    return LANG_NAMES.of(langTag);
  } catch {
    return langTag;
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

  // Order: device lang first, English second (if not device), rest alphabetically
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

const PREVIEW_FALLBACK = {
  it: "Ciao, questa è un'anteprima della voce.",
  en: "Hello, this is a quick voice preview.",
  es: "Hola, esta es una breve muestra de la voz.",
  fr: "Bonjour, ceci est un aperçu de la voix.",
  de: "Hallo, dies ist eine kurze Sprachvorschau.",
  pt: "Olá, esta é uma breve amostra da voz.",
};

function buildPreviewText(text, voice) {
  const trimmed = (text || "").trim();
  if (trimmed) {
    const match = trimmed.match(/^[\s\S]{1,140}?[.!?](?=\s|$)/);
    const snippet = (match ? match[0] : trimmed.slice(0, 140)).trim();
    if (snippet) return snippet;
  }
  const base = (voice?.lang || "en").split("-")[0].toLowerCase();
  return PREVIEW_FALLBACK[base] || PREVIEW_FALLBACK.en;
}

function IconPlay() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
      <path d="M2.5 1.5v9l8-4.5z" />
    </svg>
  );
}

function IconStop() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
      <rect x="2.5" y="2.5" width="7" height="7" />
    </svg>
  );
}

export default function VoiceSettings({
  voices, selectedVoice, setSelectedVoice,
  rate, setRate, pitch, setPitch, volume, setVolume, t,
  allowPreview = false, previewText = "",
  slidersCollapsible = false,
}) {
  const groups = groupVoicesByLang(voices);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [slidersOpen, setSlidersOpen] = useState(false);
  const activeRef = useRef(false);

  useEffect(() => {
    return () => {
      if (activeRef.current) {
        window.speechSynthesis.cancel();
        activeRef.current = false;
      }
    };
  }, []);

  function startPreview() {
    if (!selectedVoice) return;
    const u = new SpeechSynthesisUtterance(
      buildPreviewText(previewText, selectedVoice),
    );
    u.voice = selectedVoice;
    u.lang = selectedVoice.lang;
    u.rate = rate;
    u.pitch = pitch;
    u.volume = volume;
    u.onend = () => {
      activeRef.current = false;
      setIsPreviewing(false);
    };
    u.onerror = () => {
      activeRef.current = false;
      setIsPreviewing(false);
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    activeRef.current = true;
    setIsPreviewing(true);
  }

  // Restart preview (debounced) when settings change while it's playing,
  // so users hear the effect of pitch/speed/volume/voice adjustments live.
  useEffect(() => {
    if (!activeRef.current) return;
    const id = setTimeout(() => {
      if (activeRef.current) startPreview();
    }, 200);
    return () => clearTimeout(id);
  }, [rate, pitch, volume, selectedVoice?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePreview() {
    if (!allowPreview || !selectedVoice) return;
    if (activeRef.current) {
      window.speechSynthesis.cancel();
      activeRef.current = false;
      setIsPreviewing(false);
      return;
    }
    startPreview();
  }

  return (
    <div className="voice-settings">
      <div className="setting-row">
        <label className="setting-label">{t.voice}</label>
        <div className="voice-select-row">
          <select
            className="voice-select"
            aria-label={t.voice}
            value={selectedVoice?.name || ""}
            onChange={(e) =>
              setSelectedVoice(
                voices.find((v) => v.name === e.target.value) || null,
              )
            }
          >
            {groups.map(({ base, label, voices: groupVoices }) => (
              <optgroup key={base} label={label}>
                {groupVoices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {allowPreview && (
            <button
              type="button"
              className={`voice-preview-btn ${isPreviewing ? "playing" : ""}`}
              onClick={handlePreview}
              disabled={!selectedVoice}
              title={isPreviewing ? t.stopPreview : t.preview}
              aria-label={isPreviewing ? t.stopPreview : t.preview}
            >
              {isPreviewing ? <IconStop /> : <IconPlay />}
            </button>
          )}
        </div>
      </div>

      {slidersCollapsible && (
        <button
          type="button"
          className={`sliders-toggle ${slidersOpen ? "open" : ""}`}
          onClick={() => setSlidersOpen((o) => !o)}
        >
          <span>{t.slidersLabel}</span>
          <svg width="10" height="7" viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 1l5 5 5-5" />
          </svg>
        </button>
      )}

      {(!slidersCollapsible || slidersOpen) && (
        <div className="sliders">
          <div className="slider-row">
            <label className="slider-label">
              <span>{t.speed}</span>
              <span className="slider-value">{rate.toFixed(2)}×</span>
            </label>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={rate}
              aria-label={t.speed}
              aria-valuetext={`${rate.toFixed(2)}×`}
              onChange={(e) => setRate(parseFloat(e.target.value))}
            />
          </div>

          <div className="slider-row">
            <label className="slider-label">
              <span>{t.pitch}</span>
              <span className="slider-value">{pitch.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min="0.10"
              max="1.80"
              step="0.05"
              value={pitch}
              aria-label={t.pitch}
              aria-valuetext={pitch.toFixed(2)}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
            />
          </div>

          <div className="slider-row">
            <label className="slider-label">
              <span>{t.volume}</span>
              <span className="slider-value">{Math.round(volume * 100)}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              aria-label={t.volume}
              aria-valuetext={`${Math.round(volume * 100)}%`}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
