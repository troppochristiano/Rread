import VoiceSettings from "./VoiceSettings";

export default function TextInput({
  text, setText,
  voices, selectedVoice, setSelectedVoice,
  rate, setRate, pitch, setPitch, volume, setVolume,
  onStart, t,
}) {
  return (
    <div className="input-view">
      <header className="app-header">
        <h1 className="app-title">RRead.</h1>
        <p className="app-sub">{t.subtitle}</p>
      </header>

      <VoiceSettings
        voices={voices}
        selectedVoice={selectedVoice} setSelectedVoice={setSelectedVoice}
        rate={rate} setRate={setRate}
        pitch={pitch} setPitch={setPitch}
        volume={volume} setVolume={setVolume}
        t={t}
      />

      <textarea
        className="text-area"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t.placeholder}
        spellCheck={false}
      />

      <button className="start-btn" onClick={onStart} disabled={!text.trim()}>
        {t.startBtn}
      </button>
    </div>
  );
}
