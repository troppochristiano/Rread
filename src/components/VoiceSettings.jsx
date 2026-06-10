import { useCallback, useEffect, useRef, useState } from "react";
import VoiceSelect from "./VoiceSelect";

// Slider that scrolls fluidly during the drag but only commits the value on
// release — mirrors the player progress bar (local drag state, seek on drop).
function SettingSlider({ label, value, min, max, step, format, ariaLabel, onCommit, snap, cap }) {
  const [dragValue, setDragValue] = useState(null);
  const dragValueRef = useRef(null);
  const pointerDragRef = useRef(false);
  const current = dragValue !== null ? dragValue : value;

  // Pull the value to `snap` (the default/normal setting) when a pointer drag
  // lands within a small band of it, so users can flick back to default easily.
  // Only applied to pointer drags — the snap band is wider than a keyboard
  // step, so snapping arrow-key changes would trap the value at the default.
  const snapValue = useCallback(
    (v) => {
      if (snap == null || !pointerDragRef.current) return v;
      const threshold = (parseFloat(max) - parseFloat(min)) * 0.04;
      return Math.abs(v - snap) <= threshold ? snap : v;
    },
    [snap, min, max],
  );

  const commit = useCallback(() => {
    pointerDragRef.current = false;
    if (dragValueRef.current !== null) {
      onCommit(dragValueRef.current);
      dragValueRef.current = null;
      setDragValue(null);
    }
  }, [onCommit]);

  // Catch pointer release even when it happens off the input (the thumb keeps
  // dragging outside the element's bounds).
  useEffect(() => {
    window.addEventListener("pointerup", commit);
    window.addEventListener("pointercancel", commit);
    return () => {
      window.removeEventListener("pointerup", commit);
      window.removeEventListener("pointercancel", commit);
    };
  }, [commit]);

  function handleInput(e) {
    // Display scale can run past the functional cap (e.g. speed shows a fixed
    // 0–2 track but a cloud voice only allows up to 1.5×), so clamp here.
    let v = parseFloat(e.target.value);
    if (cap != null) v = Math.min(v, cap);
    v = snapValue(v);
    dragValueRef.current = v;
    setDragValue(v);
  }

  return (
    <div className="slider-row">
      <label className="slider-label">
        <span>{label}</span>
        <span className="slider-value">{format(current)}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        aria-label={ariaLabel}
        aria-valuetext={format(current)}
        onPointerDown={() => { pointerDragRef.current = true; }}
        onChange={handleInput}
        onKeyUp={commit}
        onBlur={commit}
      />
    </div>
  );
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

// iOS on-device voices distort badly past 1.5× even though they report
// localService, so they get the same cap as cloud voices. (Covers iPadOS,
// which reports as "Macintosh" with a touch screen.)
const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

function IconStop() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
      <rect x="2.5" y="2.5" width="7" height="7" />
    </svg>
  );
}

export default function VoiceSettings({
  voices,
  selectedVoice,
  setSelectedVoice,
  rate,
  setRate,
  pitch,
  setPitch,
  volume,
  setVolume,
  t,
  allowPreview = false,
  previewText = "",
  text = "",
  slidersCollapsible = false,
  onPreviewActiveChange,
}) {
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [slidersOpen, setSlidersOpen] = useState(false);
  const activeRef = useRef(false);

  // Local (on-device) voices can handle faster playback; cloud voices — and
  // iOS voices, which distort past 1.5× — stay capped at 1.5×.
  const maxRate = selectedVoice?.localService && !IS_IOS ? 2 : 1.5;

  // When switching to a voice with a different cap, rescale the rate by the
  // ratio of caps so it keeps the same proportion of the available range —
  // e.g. 2× on a local voice (max 2×) becomes 1.5× on a cloud voice (max 1.5×).
  const prevMaxRate = useRef(maxRate);
  useEffect(() => {
    const oldMax = prevMaxRate.current;
    prevMaxRate.current = maxRate;
    if (oldMax === maxRate) return;
    setRate((r) => Math.min(maxRate, Math.round(r * (maxRate / oldMax) * 100) / 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxRate]);

  useEffect(() => {
    return () => {
      if (activeRef.current) {
        onPreviewActiveChange?.(false);
        window.speechSynthesis.cancel();
        activeRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startPreview() {
    if (!selectedVoice) return;
    const u = new SpeechSynthesisUtterance(
      buildPreviewText(previewText, selectedVoice),
    );
    u.voice = selectedVoice;
    u.lang = selectedVoice.lang;
    u.rate = Math.max(0.1, rate);
    u.pitch = pitch;
    u.volume = volume;
    const endPreview = () => {
      activeRef.current = false;
      setIsPreviewing(false);
      onPreviewActiveChange?.(false);
    };
    u.onend = endPreview;
    u.onerror = endPreview;
    // Signal BEFORE touching the speech queue so an in-flight probe sees the
    // preview as user-active and bails out without cancelling our utterance.
    onPreviewActiveChange?.(true);
    activeRef.current = true;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setIsPreviewing(true);
  }

  // Restart preview (debounced) when sliders change while it's playing,
  // so users hear the effect of pitch/speed/volume adjustments live.
  useEffect(() => {
    if (!activeRef.current) return;
    const id = setTimeout(() => {
      if (activeRef.current) startPreview();
    }, 200);
    return () => clearTimeout(id);
  }, [rate, pitch, volume]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop preview when the selected voice changes mid-playback.
  useEffect(() => {
    if (!activeRef.current) return;
    window.speechSynthesis.cancel();
    activeRef.current = false;
    setIsPreviewing(false);
    onPreviewActiveChange?.(false);
  }, [selectedVoice?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePreview() {
    if (!allowPreview || !selectedVoice) return;
    if (activeRef.current) {
      window.speechSynthesis.cancel();
      activeRef.current = false;
      setIsPreviewing(false);
      onPreviewActiveChange?.(false);
      return;
    }
    startPreview();
  }

  return (
    <div className="voice-settings">
      <div className="setting-row">
        <label className="setting-label">
          <span>{t.voice}</span>
        </label>
        <div className="voice-select-row">
          <VoiceSelect
            voices={voices}
            selectedVoice={selectedVoice}
            setSelectedVoice={setSelectedVoice}
            text={text || previewText}
            t={t}
          />
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
        </button>
      )}

      {(!slidersCollapsible || slidersOpen) && (
        <div className="sliders">
          <SettingSlider
            label={t.speed}
            value={rate}
            min="0"
            max="2"
            cap={maxRate}
            step="0.01"
            format={(v) => `${v.toFixed(2)}×`}
            ariaLabel={t.speed}
            onCommit={setRate}
            snap={1}
          />

          <SettingSlider
            label={t.pitch}
            value={pitch}
            min="0.10"
            max="1.80"
            step="0.01"
            format={(v) => (((v - 0.1) / 1.7) * 2 - 1).toFixed(2)}
            ariaLabel={t.pitch}
            onCommit={setPitch}
            snap={0.95}
          />

          <SettingSlider
            label={t.volume}
            value={volume}
            min="0"
            max="1"
            step="0.01"
            format={(v) => `${Math.round(v * 100)}%`}
            ariaLabel={t.volume}
            onCommit={setVolume}
          />
        </div>
      )}

    </div>
  );
}
