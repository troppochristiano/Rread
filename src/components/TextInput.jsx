import VoiceSettings from "./VoiceSettings";

export default function TextInput({
  text,
  setText,
  voices,
  selectedVoice,
  setSelectedVoice,
  rate,
  setRate,
  pitch,
  setPitch,
  volume,
  setVolume,
  onStart,
}) {
  return (
    <div className="input-view">
      <header className="app-header">
        <h1 className="app-title">RRead.</h1>
        <p className="app-sub">Incolla il testo e ascoltalo</p>
      </header>

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

      <textarea
        className="text-area"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Incolla qui il testo da leggere…"
        spellCheck={false}
      />

      <button className="start-btn" onClick={onStart} disabled={!text.trim()}>
        Inizia lettura
      </button>
    </div>
  );
}
