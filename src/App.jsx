import { useState, useMemo, useEffect } from "react";
import { useVoices } from "./hooks/useVoices";
import {
  usePersistence,
  getInitialText,
  getSavedPositionForText,
} from "./hooks/usePersistence";
import { useSpeech } from "./hooks/useSpeech";
import { cleanTextForSpeech } from "./utils/textCleaner";
import { splitIntoSentences } from "./utils/textSplitter";
import TextInput from "./components/TextInput";
import TextDisplay from "./components/TextDisplay";
import Player from "./components/Player";
import VoiceSettings from "./components/VoiceSettings";
import ResumePrompt from "./components/ResumePrompt";
import "./styles/globals.css";

export default function App() {
  const { voices, selectedVoice, setSelectedVoice } = useVoices();
  const [text, setText] = useState(() => getInitialText());
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [volume, setVolume] = useState(1);
  const [view, setView] = useState("input"); // 'input' | 'player'
  const [resumePosition, setResumePosition] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingPlay, setPendingPlay] = useState(false);

  const chunks = useMemo(
    () => splitIntoSentences(cleanTextForSpeech(text)),
    [text],
  );

  const {
    isPlaying,
    chunkIndex,
    wordIndex,
    scrollTrigger,
    play,
    pause,
    stop,
    skip,
    seekTo,
  } = useSpeech({ chunks, selectedVoice, rate, pitch, volume });

  usePersistence({ text, chunkIndex, chunks });

  // Trigger play once the player view is mounted
  useEffect(() => {
    if (pendingPlay && view === "player") {
      play();
      setPendingPlay(false);
    }
  }); // runs every render, checks conditions

  // ── Navigation ──────────────────────────────────────────────────────────────

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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      {view === "input" && (
        <TextInput
          text={text}
          setText={setText}
          voices={voices}
          selectedVoice={selectedVoice}
          setSelectedVoice={setSelectedVoice}
          rate={rate}
          setRate={setRate}
          pitch={pitch}
          setPitch={setPitch}
          volume={volume}
          setVolume={setVolume}
          onStart={handleStart}
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
            wordIndex={wordIndex}
            scrollTrigger={scrollTrigger}
            seekTo={seekTo}
          />

          <div className="player-settings">
            <button
              className={`settings-toggle ${settingsOpen ? "open" : ""}`}
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <span>Impostazioni voce</span>
              <svg
                width="12"
                height="8"
                viewBox="0 0 12 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M1 1l5 5 5-5" />
              </svg>
            </button>
            {settingsOpen && (
              <div className="settings-panel">
                <VoiceSettings
                  voices={voices}
                  selectedVoice={selectedVoice}
                  setSelectedVoice={setSelectedVoice}
                  rate={rate}
                  setRate={setRate}
                  pitch={pitch}
                  setPitch={setPitch}
                  volume={volume}
                  setVolume={setVolume}
                />
              </div>
            )}
          </div>

          <Player
            isPlaying={isPlaying}
            chunkIndex={chunkIndex}
            chunks={chunks}
            play={play}
            pause={pause}
            stop={handleStop}
            skip={skip}
            seekTo={seekTo}
          />
        </div>
      )}

      {resumePosition && (
        <ResumePrompt
          position={resumePosition}
          onResume={handleResume}
          onRestart={handleRestart}
        />
      )}
    </div>
  );
}
