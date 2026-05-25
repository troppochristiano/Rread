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
  onOpenLibrary,
  libraryItem,
  librarySaving,
  t,
  onPreviewActiveChange,
}) {
  return (
    <div className="input-view">
      <header className="app-header">
        <h1 className="app-title">RRead.</h1>
        <p className="app-sub">{t.subtitle}</p>
      </header>

      <div className="input-settings">
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
          t={t}
          allowPreview
          // previewText={text}
          slidersCollapsible
          onPreviewActiveChange={onPreviewActiveChange}
        />
      </div>

      <div className="textarea-wrap">
        {libraryItem && (
          <div className="library-context">
            <span className="library-context-title">{libraryItem.title}</span>
            {librarySaving && <span className="library-context-saving">{t.libraryContextSaving}</span>}
          </div>
        )}
        <textarea
          className="text-area"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.placeholder}
          spellCheck={false}
        />
        <div className="textarea-toolbar">
          <button
            type="button"
            className="import-btn"
            onClick={onOpenLibrary}
            title={t.libraryOpen}
          >
            {t.library}
          </button>
        </div>
      </div>

      <button
        className="start-btn"
        onClick={onStart}
        disabled={!text.trim()}
      >
        {t.startBtn}
      </button>
    </div>
  );
}
