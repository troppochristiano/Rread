import { useRef, useState } from "react";
import VoiceSettings from "./VoiceSettings";
import { importFileToText, ACCEPT_FILE_TYPES } from "../utils/fileImport";

export default function TextInput({
  text, setText,
  voices, selectedVoice, setSelectedVoice,
  rate, setRate, pitch, setPitch, volume, setVolume,
  onStart, t,
  isProbing, probeProgress, onReprobe, onPreviewActiveChange,
}) {
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportError(null);
    setImporting(true);
    try {
      const extracted = await importFileToText(file);
      setText(extracted);
    } catch (err) {
      console.error("Import failed:", err);
      setImportError(t.importError);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="input-view">
      <header className="app-header">
        <h1 className="app-title">RRead.</h1>
        <p className="app-sub">{t.subtitle}</p>
      </header>

      <div className="input-settings">
        <VoiceSettings
          voices={voices}
          selectedVoice={selectedVoice} setSelectedVoice={setSelectedVoice}
          rate={rate} setRate={setRate}
          pitch={pitch} setPitch={setPitch}
          volume={volume} setVolume={setVolume}
          t={t}
          allowPreview
          previewText={text}
          slidersCollapsible
          isProbing={isProbing}
          probeProgress={probeProgress}
          onReprobe={onReprobe}
          onPreviewActiveChange={onPreviewActiveChange}
        />
      </div>

      <div className="textarea-wrap">
        <textarea
          className="text-area"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.placeholder}
          spellCheck={false}
        />
        <div className="textarea-toolbar">
          <span className="import-formats">txt · md · pdf · epub</span>
          {importError && <span className="import-error">{importError}</span>}
          <button
            type="button"
            className="import-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            title={t.importHint}
          >
            {importing ? t.importing : t.importBtn}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_FILE_TYPES}
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      </div>

      <button className="start-btn" onClick={onStart} disabled={!text.trim() || importing}>
        {t.startBtn}
      </button>
    </div>
  );
}
