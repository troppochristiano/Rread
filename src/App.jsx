import { useState, useMemo, useEffect, useCallback } from "react";
import { useVoices } from "./hooks/useVoices";
import {
  usePersistence,
  getInitialText,
  getSavedPositionForText,
} from "./hooks/usePersistence";
import { useSpeech } from "./hooks/useSpeech";
import { cleanTextForSpeech } from "./utils/textCleaner";
import { splitIntoSentences } from "./utils/textSplitter";
import { translations } from "./i18n";
import TextInput from "./components/TextInput";
import TextDisplay from "./components/TextDisplay";
import Player from "./components/Player";
import VoiceSettings from "./components/VoiceSettings";
import ResumePrompt from "./components/ResumePrompt";
import "./styles/globals.css";

function IconSun() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

export default function App() {
  const { voices, selectedVoice, setSelectedVoice } = useVoices();
  const [text, setText] = useState(() => getInitialText());

  const [theme, setTheme] = useState(() => localStorage.getItem("tts_theme") || "light");
  const [locale, setLocale] = useState(() => localStorage.getItem("tts_locale") || "it");
  const t = translations[locale];

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("tts_theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("tts_locale", locale);
  }, [locale]);

  const toggleTheme = useCallback(() => setTheme(th => th === "light" ? "dark" : "light"), []);

  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [volume, setVolume] = useState(1);
  const [view, setView] = useState("input");
  const [resumePosition, setResumePosition] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingPlay, setPendingPlay] = useState(false);

  const chunks = useMemo(
    () => splitIntoSentences(cleanTextForSpeech(text)),
    [text],
  );

  const { isPlaying, chunkIndex, subscribeWordIndex, getWordIndex, scrollTrigger, play, pause, stop, skip, seekTo } =
    useSpeech({ chunks, selectedVoice, rate, pitch, volume });

  usePersistence({ text, chunkIndex, chunks });

  useEffect(() => {
    if (pendingPlay && view === "player") {
      play();
      setPendingPlay(false);
    }
  }, [pendingPlay, view]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleStart() {
    if (!text.trim()) return;
    const saved = getSavedPositionForText(text);
    if (saved && saved.pct > 1) {
      setResumePosition(saved);
    } else {
      seekTo(0);
      setView("player");
      setPendingPlay(true);
    }
  }

  function handleRestart() {
    setResumePosition(null);
    seekTo(0);
    setView("player");
    setPendingPlay(true);
  }

  function handleResume(pos) {
    setResumePosition(null);
    seekTo(pos.index);
    setView("player");
    setPendingPlay(true);
  }

  function handleStop() {
    stop();
    setView("input");
    setSettingsOpen(false);
  }

  return (
    <div className="app">
      {view === "input" && (
        <TextInput
          text={text} setText={setText}
          voices={voices}
          selectedVoice={selectedVoice} setSelectedVoice={setSelectedVoice}
          rate={rate} setRate={setRate}
          pitch={pitch} setPitch={setPitch}
          volume={volume} setVolume={setVolume}
          onStart={handleStart}
          t={t}
        />
      )}

      {view === "player" && (
        <div className="player-view">
          <div className="player-header">
            <span className="player-title">RRead.</span>
          </div>

          <TextDisplay
            chunks={chunks}
            chunkIndex={chunkIndex}
            subscribeWordIndex={subscribeWordIndex}
            getWordIndex={getWordIndex}
            scrollTrigger={scrollTrigger}
            seekTo={seekTo}
          />

          <div className="player-settings">
            <button
              className={`settings-toggle ${settingsOpen ? "open" : ""}`}
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <span>{t.voiceSettings}</span>
              <svg width="12" height="8" viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M1 1l5 5 5-5" />
              </svg>
            </button>
            {settingsOpen && (
              <div className="settings-panel">
                <VoiceSettings
                  voices={voices}
                  selectedVoice={selectedVoice} setSelectedVoice={setSelectedVoice}
                  rate={rate} setRate={setRate}
                  pitch={pitch} setPitch={setPitch}
                  volume={volume} setVolume={setVolume}
                  t={t}
                />
              </div>
            )}
          </div>

          <Player
            isPlaying={isPlaying}
            chunkIndex={chunkIndex}
            chunks={chunks}
            play={play} pause={pause} stop={handleStop}
            skip={skip} seekTo={seekTo}
            t={t}
          />
        </div>
      )}

      {resumePosition && (
        <ResumePrompt
          position={resumePosition}
          onResume={handleResume}
          onRestart={handleRestart}
          t={t}
        />
      )}

      <div className="corner-controls">
        <button className="corner-btn" onClick={() => setLocale(l => l === "it" ? "en" : "it")} title="Toggle language">
          {locale.toUpperCase()}
        </button>
        <button className="corner-btn" onClick={toggleTheme} title="Toggle theme">
          {theme === "dark" ? <IconSun /> : <IconMoon />}
        </button>
      </div>
    </div>
  );
}
