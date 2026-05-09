// SVG icon primitives
function IconStop() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      <rect x="3" y="3" width="12" height="12" rx="2" />
    </svg>
  );
}
function IconSkipBack() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      <polygon points="9,4 2,9 9,14" />
      <polygon points="16,4 9,9 16,14" />
    </svg>
  );
}
function IconSkipForward() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      <polygon points="9,4 16,9 9,14" />
      <polygon points="2,4 9,9 2,14" />
    </svg>
  );
}
function IconPlay() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <polygon points="4,2 18,10 4,18" />
    </svg>
  );
}
function IconPause() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <rect x="3" y="2" width="5" height="16" rx="1.5" />
      <rect x="12" y="2" width="5" height="16" rx="1.5" />
    </svg>
  );
}

export default function Player({
  isPlaying, chunkIndex, chunks,
  play, pause, stop, skip, seekTo,
}) {
  const total = chunks.length;
  const pct = total > 0 ? (chunkIndex / total) * 100 : 0;

  function handleProgressClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seekTo(Math.round(ratio * (total - 1)));
  }

  return (
    <div className="player-bar">
      {/* Progress bar */}
      <div className="progress-track" onClick={handleProgressClick} title="Clicca per saltare">
        <div className="progress-fill" style={{ width: `${pct.toFixed(1)}%` }} />
        <div className="progress-thumb" style={{ left: `${pct.toFixed(1)}%` }} />
      </div>

      <div className="progress-info">
        <span>{Math.round(pct)}%</span>
        <span>{total > 0 ? `Frase ${chunkIndex + 1} / ${total}` : '—'}</span>
      </div>

      {/* Controls */}
      <div className="player-controls">
        <button className="ctrl-btn" onClick={stop} title="Stop — torna all'input">
          <IconStop />
        </button>
        <button className="ctrl-btn" onClick={() => skip(-1)} title="Frase precedente">
          <IconSkipBack />
        </button>
        <button className="ctrl-btn play-pause-btn" onClick={isPlaying ? pause : play} title={isPlaying ? 'Pausa' : 'Riproduci'}>
          {isPlaying ? <IconPause /> : <IconPlay />}
        </button>
        <button className="ctrl-btn" onClick={() => skip(1)} title="Frase successiva">
          <IconSkipForward />
        </button>
        <div className={`playing-dots${isPlaying ? ' active' : ''}`} aria-hidden="true">
          <span /><span /><span />
        </div>
      </div>
    </div>
  );
}
