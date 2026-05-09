export default function ResumePrompt({ position, onResume, onRestart, t }) {
  return (
    <div className="resume-overlay" onClick={onRestart}>
      <div className="resume-modal" onClick={e => e.stopPropagation()}>
        <p className="resume-title">{t.resumeTitle}</p>
        <p className="resume-desc">{t.resumeDesc(position.pct, position.index)}</p>
        <div className="resume-buttons">
          <button className="resume-btn secondary" onClick={onRestart}>
            {t.restart}
          </button>
          <button className="resume-btn primary" onClick={() => onResume(position)}>
            {t.resume(position.pct)}
          </button>
        </div>
      </div>
    </div>
  );
}
