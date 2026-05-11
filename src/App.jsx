import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useVoices } from "./hooks/useVoices";
import {
  usePersistence,
  getInitialText,
  getSavedPositionForText,
} from "./hooks/usePersistence";
import { useSpeech } from "./hooks/useSpeech";
import { useMediaSession } from "./hooks/useMediaSession";
import { cleanTextForSpeech } from "./utils/textCleaner";
import { splitIntoSentences } from "./utils/textSplitter";
import { translations } from "./i18n";
import TextInput from "./components/TextInput";
import TextDisplay from "./components/TextDisplay";
import Player from "./components/Player";
import VoiceSettings from "./components/VoiceSettings";
import ResumePrompt from "./components/ResumePrompt";
import AboutModal from "./components/AboutModal";
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

function IconInfo() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="8"/>
      <line x1="12" y1="12" x2="12" y2="16"/>
    </svg>
  );
}

function IconSliders() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="1" y1="4" x2="14" y2="4"/>
      <line x1="1" y1="11" x2="14" y2="11"/>
      <circle cx="5" cy="4" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="10" cy="11" r="1.5" fill="currentColor" stroke="none"/>
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingPlay, setPendingPlay] = useState(false);
  const [scrollBump, setScrollBump] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);

  const chunks = useMemo(
    () => splitIntoSentences(cleanTextForSpeech(text)),
    [text],
  );

  const { isPlaying, chunkIndex, subscribeWordIndex, getWordIndex, scrollTrigger, play, pause, stop, skip, seekTo } =
    useSpeech({ chunks, selectedVoice, rate, pitch, volume });

  const { clearPosition } = usePersistence({ text, chunkIndex, chunks });

  // When playback ends naturally (isPlaying→false, chunkIndex resets to 0),
  // clear the saved position so Start begins from the top next time.
  const prevIsPlayingRef = useRef(false);
  useEffect(() => {
    if (prevIsPlayingRef.current && !isPlaying && chunkIndex === 0) {
      clearPosition();
    }
    prevIsPlayingRef.current = isPlaying;
  }, [isPlaying, chunkIndex, clearPosition]);

  useEffect(() => {
    if (pendingPlay && view === "player") {
      play();
      setPendingPlay(false);
    }
  }, [pendingPlay, view]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleStart() {
    if (!text.trim()) return;
    const saved = getSavedPositionForText(text);
    if (saved && saved.index > 0) {
      setResumePosition(saved);
    } else {
      seekTo(0);
      setView("player");
      setPendingPlay(true);
    }
  }

  function handleRestart() {
    setResumePosition(null);
    clearPosition();
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

  const docTitle = useMemo(() => {
    const snippet = text.trim().split(/\s+/).slice(0, 8).join(" ");
    return snippet ? snippet.slice(0, 80) : "RRead";
  }, [text]);

  useMediaSession({
    title: docTitle,
    isPlaying,
    active: view === "player",
    onPlay: play,
    onPause: pause,
    onStop: handleStop,
    onSkip: skip,
  });

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
            <button className="corner-btn mobile-only player-header-settings" onClick={() => setMobileMenuOpen(o => !o)} title="Settings">
              <IconSliders />
            </button>
          </div>

          <TextDisplay
            chunks={chunks}
            chunkIndex={chunkIndex}
            subscribeWordIndex={subscribeWordIndex}
            getWordIndex={getWordIndex}
            scrollTrigger={scrollTrigger}
            scrollBump={scrollBump}
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
            onCenterActive={() => setScrollBump(n => n + 1)}
            t={t}
          />
        </div>
      )}

      {resumePosition && (
        <ResumePrompt
          position={resumePosition}
          onResume={handleResume}
          onRestart={handleRestart}
          onDismiss={() => setResumePosition(null)}
          t={t}
        />
      )}

      <div className="corner-controls">
        <button className="corner-btn desktop-only" onClick={() => setAboutOpen(true)} title="About">
          <IconInfo />
        </button>
        <button className="corner-btn desktop-only" onClick={() => setLocale(l => l === "it" ? "en" : "it")} title="Toggle language">
          {locale.toUpperCase()}
        </button>
        <button className="corner-btn desktop-only" onClick={toggleTheme} title="Toggle theme">
          {theme === "dark" ? <IconSun /> : <IconMoon />}
        </button>
        {view === "input" && (
          <button className="corner-btn mobile-only" onClick={() => setMobileMenuOpen(o => !o)} title="Settings">
            <IconSliders />
          </button>
        )}
      </div>

      {aboutOpen && <AboutModal locale={locale} onClose={() => setAboutOpen(false)} />}

      {mobileMenuOpen && (
        <>
          <div className="mobile-menu-backdrop" onClick={() => setMobileMenuOpen(false)} />
          <div className={`mobile-menu-panel mobile-menu-panel--${view}`}>
            <button className="mobile-menu-item" onClick={() => { setAboutOpen(true); setMobileMenuOpen(false); }}>
              <span className="mobile-menu-item-label">{t.about}</span>
              <span className="mobile-menu-item-value"><IconInfo /></span>
            </button>
            <button className="mobile-menu-item" onClick={() => setLocale(l => l === "it" ? "en" : "it")}>
              <span className="mobile-menu-item-label">{t.language}</span>
              <span className="mobile-menu-item-value">{locale.toUpperCase()}</span>
            </button>
            <button className="mobile-menu-item" onClick={toggleTheme}>
              <span className="mobile-menu-item-label">{theme === "dark" ? t.lightMode : t.darkMode}</span>
              <span className="mobile-menu-item-value">{theme === "dark" ? <IconSun /> : <IconMoon />}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
