export default function ResumePrompt({ position, onResume, onRestart }) {
  return (
    <div className="resume-overlay" onClick={onRestart}>
      <div className="resume-modal" onClick={e => e.stopPropagation()}>
        <p className="resume-title">Sessione precedente</p>
        <p className="resume-desc">
          Hai lasciato al <strong>{position.pct}%</strong>
          {' '}(frase {position.index + 1})
        </p>
        <div className="resume-buttons">
          <button className="resume-btn secondary" onClick={onRestart}>
            Ricomincia
          </button>
          <button className="resume-btn primary" onClick={() => onResume(position)}>
            Riprendi {position.pct}%
          </button>
        </div>
      </div>
    </div>
  );
}
