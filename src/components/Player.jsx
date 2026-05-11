import { useState } from 'react';

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
  play, pause, stop, skip, seekTo, t,
  onCenterActive,
}) {
  const total = chunks.length;
  const pct = total > 0 ? (chunkIndex / total) * 100 : 0;
  const [hoverPct, setHoverPct] = useState(null);

  function handleProgressClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(Math.round(ratio * (total - 1)));
  }

  function handleMouseMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPct(ratio * 100);
  }

  const hoverSentence = hoverPct !== null && total > 0
    ? Math.round((hoverPct / 100) * (total - 1)) + 1
    : null;

  const isHovering = hoverPct !== null;

  return (
    <div className="player-bar">
      {/* Progress bar — fixed-height wrapper keeps layout stable during bar expansion */}
      <div
        className={`progress-track${isHovering ? ' hovered' : ''}`}
        onClick={handleProgressClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverPct(null)}
      >
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${pct.toFixed(1)}%` }} />
        </div>

        {/* Thumb sits at playback position, pops in on hover */}
        <div
          className={`progress-thumb${isHovering ? ' visible' : ''}`}
          style={{ left: `${pct.toFixed(1)}%` }}
        />

        {/* Tooltip follows cursor, shows where click will jump to */}
        {isHovering && (
          <div className="progress-tooltip" style={{ left: `${hoverPct.toFixed(1)}%` }}>
            {hoverSentence}/{total}
          </div>
        )}
      </div>

      <div className="progress-info">
        <span>{Math.round(pct)}%</span>
        <span>{total > 0 ? t.sentence(chunkIndex, total) : '—'}</span>
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
        <button
          type="button"
          className={`playing-dots${isPlaying ? ' active' : ''}`}
          onClick={onCenterActive}
          title="Vai al testo evidenziato"
        >
          <span /><span /><span />
        </button>
      </div>
    </div>
  );
}
