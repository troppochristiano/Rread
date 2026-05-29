import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useVoices } from "./hooks/useVoices";
import {
  usePersistence,
  getInitialText,
  getSavedPositionForText,
} from "./hooks/usePersistence";
import { useSpeech } from "./hooks/useSpeech";
import { useMediaSession } from "./hooks/useMediaSession";
import { useSilentAudio } from "./hooks/useSilentAudio";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useLibrary } from "./hooks/useLibrary";
import { cleanTextForSpeech } from "./utils/textCleaner";
import { splitIntoSentences } from "./utils/textSplitter";
import { translations } from "./i18n";
import TextInput from "./components/TextInput";
import TextDisplay from "./components/TextDisplay";
import Player from "./components/Player";
import VoiceSettings from "./components/VoiceSettings";
import ResumePrompt from "./components/ResumePrompt";
import AboutModal from "./components/AboutModal";
import Library from "./components/Library";
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

function IconKeyboard() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2"/>
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>
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

function IconRefresh() {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.5 2v3h-3" />
      <path d="M10.5 5A4.5 4.5 0 1 0 9 9.5" />
    </svg>
  );
}

export default function App() {
  const { voices, selectedVoice, setSelectedVoice, isProbing, probeProgress, reprobe, stopProbe, setUserPlaying, setPreviewActive } = useVoices();
  const library = useLibrary();
  const [text, setText] = useState(() => getInitialText());

  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("tts_theme");
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [locale, setLocale] = useState(() => {
    const saved = localStorage.getItem("tts_locale");
    if (saved && translations[saved]) return saved;
    const browser = (navigator.language || "").toLowerCase();
    for (const code of Object.keys(translations)) {
      if (browser.startsWith(code)) return code;
    }
    return "en";
  });
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
  const pendingPlayRef = useRef(false);
  const [scrollBump, setScrollBump] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryPulse, setLibraryPulse] = useState(
    () => localStorage.getItem("tts_library_pulse") === "1",
  );

  function activateLibraryPulse() {
    setLibraryPulse(true);
    localStorage.setItem("tts_library_pulse", "1");
  }
  function openLibrary() {
    setLibraryOpen(true);
    if (libraryPulse) {
      setLibraryPulse(false);
      localStorage.removeItem("tts_library_pulse");
    }
  }

  const chunks = useMemo(
    () => splitIntoSentences(cleanTextForSpeech(text)),
    [text],
  );

  const {
    isPlaying, chunkIndex, batchEndIndex, subscribeWordIndex, getWordIndex, scrollTrigger,
    play, pause, stop, skip, seekTo,
    speechError, clearSpeechError,
    wordHighlightSupported, dismissWordHighlightWarning,
  } = useSpeech({ chunks, selectedVoice, rate, pitch, volume });

  // Pause the voice probe while the user is listening so probe utterances
  // don't fight with playback for the speech queue.
  useEffect(() => {
    setUserPlaying(isPlaying);
  }, [isPlaying, setUserPlaying]);

  const { clearPosition } = usePersistence({ text, chunkIndex, chunks });

  const [librarySaving, setLibrarySaving] = useState(false);

  function handleUserTextChange(newText) {
    setText(newText);
    if (!library.selectedId && newText.trim()) {
      const id = library.create('');
      if (id) {
        library.update(id, newText);
        library.setSelectedId(id);
        activateLibraryPulse();
      }
    }
  }

  // Auto-update the selected library item when text changes.
  useEffect(() => {
    if (!library.selectedId) return;
    setLibrarySaving(true);
    const timer = setTimeout(() => {
      library.update(library.selectedId, text);
      setLibrarySaving(false);
    }, 800);
    return () => clearTimeout(timer);
  }, [text, library.selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (pendingPlayRef.current && view === "player") {
      pendingPlayRef.current = false;
      play();
    }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleStart() {
    if (!text.trim()) return;
    unlockSilentAudio();
    const saved = getSavedPositionForText(text);
    if (saved && saved.index > 0) {
      setResumePosition(saved);
    } else {
      setUserPlaying(true);
      seekTo(0);
      setView("player");
      pendingPlayRef.current = true;
    }
  }

  function handleRestart() {
    unlockSilentAudio();
    setUserPlaying(true);
    setResumePosition(null);
    clearPosition();
    seekTo(0);
    setView("player");
    pendingPlayRef.current = true;
  }

  function handleResume(pos) {
    unlockSilentAudio();
    setUserPlaying(true);
    setResumePosition(null);
    seekTo(pos.index);
    setView("player");
    pendingPlayRef.current = true;
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

  useKeyboardShortcuts({
    active: view === 'player',
    isPlaying,
    play, pause, stop: handleStop, skip,
  });

  useMediaSession({
    title: docTitle,
    isPlaying,
    active: view === "player",
    onPlay: play,
    onPause: pause,
    onStop: handleStop,
    onSkip: skip,
  });

  const { unlock: unlockSilentAudio } = useSilentAudio(isPlaying);

  return (
    <div className="app">
      {view === "input" && (
        <TextInput
          text={text} setText={handleUserTextChange}
          voices={voices}
          selectedVoice={selectedVoice} setSelectedVoice={setSelectedVoice}
          rate={rate} setRate={setRate}
          pitch={pitch} setPitch={setPitch}
          volume={volume} setVolume={setVolume}
          libraryItem={library.items.find(i => i.id === library.selectedId) ?? null}
          librarySaving={librarySaving}
          onStart={handleStart}
          onOpenLibrary={openLibrary}
          libraryPulse={libraryPulse}
          onPreviewActiveChange={setPreviewActive}
          t={t}
        />
      )}

      {view === "player" && (
        <div className="player-view">
          <div className="player-header">
            <span className="player-title">RRead.</span>
            <button className="corner-btn mobile-only player-header-settings" onClick={() => setMobileMenuOpen(o => !o)} title={t.ariaMenuOpen} aria-label={t.ariaMenuOpen}>
              <IconSliders />
            </button>
          </div>

          <TextDisplay
            chunks={chunks}
            chunkIndex={chunkIndex}
            batchEndIndex={batchEndIndex}
            subscribeWordIndex={subscribeWordIndex}
            getWordIndex={getWordIndex}
            scrollTrigger={scrollTrigger}
            scrollBump={scrollBump}
            isPlaying={isPlaying}
            rate={rate}
            seekTo={seekTo}
            onCenterActive={() => setScrollBump(n => n + 1)}
            t={t}
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
                  text={text}
                  onPreviewActiveChange={setPreviewActive}
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
        <button className="corner-btn desktop-only" onClick={() => setAboutOpen(true)} title={t.about} aria-label={t.about}>
          <IconInfo />
        </button>
        <div className="keyboard-help desktop-only">
          <button
            className="corner-btn"
            onClick={() => setShortcutsOpen(o => !o)}
            title={t.shortcutsTitle}
            aria-label={t.shortcutsTitle}
            aria-expanded={shortcutsOpen}
          >
            <IconKeyboard />
          </button>
          {shortcutsOpen && (
            <>
              <div className="keyboard-help-backdrop" onClick={() => setShortcutsOpen(false)} />
              <div className="keyboard-help-popup" role="tooltip">
                <div className="keyboard-help-title">{t.shortcutsTitle}</div>
                <table><tbody>
                  <tr><td>Space</td><td>{t.shortcutSpace.replace(/^Spazio — |^Space — /, '')}</td></tr>
                  <tr><td>←</td><td>{t.shortcutLeft.replace(/^← — /, '')}</td></tr>
                  <tr><td>→</td><td>{t.shortcutRight.replace(/^→ — /, '')}</td></tr>
                  <tr><td>Esc</td><td>{t.shortcutEsc.replace(/^Esc — /, '')}</td></tr>
                </tbody></table>
              </div>
            </>
          )}
        </div>
        <button className="corner-btn desktop-only" onClick={() => setLocale(l => l === "it" ? "en" : "it")} title={t.ariaToggleLang} aria-label={t.ariaToggleLang}>
          {locale.toUpperCase()}
        </button>
        <button className="corner-btn desktop-only" onClick={toggleTheme} title={theme === "dark" ? t.lightMode : t.darkMode} aria-label={theme === "dark" ? t.lightMode : t.darkMode}>
          {theme === "dark" ? <IconSun /> : <IconMoon />}
        </button>
        <button
          className={`corner-btn corner-btn-sync desktop-only ${isProbing ? "probing" : ""}`}
          onClick={isProbing ? stopProbe : reprobe}
          title={isProbing ? t.stopProbe : t.reprobeVoices}
          aria-label={isProbing ? t.stopProbe : t.reprobeVoices}
          style={
            isProbing && probeProgress.total > 0
              ? { "--sync-fill": `${(probeProgress.done / probeProgress.total) * 100}%` }
              : undefined
          }
        >
          {isProbing ? (
            <span className="sync-progress">
              {probeProgress.total > 0
                ? `${probeProgress.done}/${probeProgress.total}`
                : "…"}
            </span>
          ) : (
            <IconRefresh />
          )}
        </button>
        {view === "input" && (
          <button className="corner-btn mobile-only" onClick={() => setMobileMenuOpen(o => !o)} title={t.ariaMenuOpen} aria-label={t.ariaMenuOpen}>
            <IconSliders />
          </button>
        )}
      </div>

      {speechError && (
        <div className="speech-error-banner" role="alert">
          <span>{t.speechError}</span>
          <button onClick={clearSpeechError} aria-label="Dismiss">×</button>
        </div>
      )}

      {view === "player" && wordHighlightSupported === false && (
        <div className="speech-error-banner word-highlight-banner" role="alert">
          <span>{t.wordHighlightUnsupported}</span>
          <button onClick={dismissWordHighlightWarning} aria-label="Dismiss">×</button>
        </div>
      )}

      {aboutOpen && <AboutModal locale={locale} onClose={() => setAboutOpen(false)} />}

      <Library
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onNew={() => {
          setText('');
          const id = library.create('');
          if (id) library.setSelectedId(id);
          return id;
        }}
        onLoad={(item) => { setText(item.text); library.setSelectedId(item.id); }}
        library={library}
        t={t}
      />

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
