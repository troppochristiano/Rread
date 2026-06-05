import { useRef, useState } from 'react';

export function IconStop() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      <rect x="3" y="3" width="12" height="12" rx="2" />
    </svg>
  );
}
export function IconSkipBack() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      <polygon points="9,4 2,9 9,14" />
      <polygon points="16,4 9,9 16,14" />
    </svg>
  );
}
export function IconSkipForward() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      <polygon points="9,4 16,9 9,14" />
      <polygon points="2,4 9,9 2,14" />
    </svg>
  );
}
export function IconPlay() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <polygon points="4,2 18,10 4,18" />
    </svg>
  );
}
export function IconPause() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      <rect x="3" y="2" width="5" height="16" rx="1.5" />
      <rect x="12" y="2" width="5" height="16" rx="1.5" />
    </svg>
  );
}
export function IconDots() {
  return (
    <span className="legend-dots"><span /><span /><span /></span>
  );
}

export default function Player({
  isPlaying, chunkIndex, chunks,
  play, pause, stop, skip, seekTo, t,
  onCenterActive,
}) {
  const total = chunks.length;
  const playbackPct = total > 0 ? (chunkIndex / total) * 100 : 0;
  const [hoverPct, setHoverPct] = useState(null);
  const [dragPct, setDragPct] = useState(null);
  const isDragging = useRef(false);
  const pct = dragPct !== null ? dragPct : playbackPct;

  function ratioFromEvent(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  function handlePointerDown(e) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    const ratio = ratioFromEvent(e);
    setHoverPct(ratio * 100);
    setDragPct(ratio * 100);
  }

  function handlePointerMove(e) {
    const ratio = ratioFromEvent(e);
    setHoverPct(ratio * 100);
    if (isDragging.current) setDragPct(ratio * 100);
  }

  function handlePointerUp(e) {
    const wasDragging = isDragging.current;
    isDragging.current = false;
    const ratio = ratioFromEvent(e);
    setDragPct(null);
    if (wasDragging) {
      seekTo(Math.round(ratio * (total - 1)));
    }
  }

  function handlePointerLeave(e) {
    if (!isDragging.current) setHoverPct(null);
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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        style={{ cursor: 'pointer', touchAction: 'none' }}
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
        <button className="ctrl-btn" onClick={stop} title={t.stopTitle} aria-label={t.stopTitle}>
          <IconStop />
        </button>
        <button className="ctrl-btn" onClick={() => skip(-1)} title={t.prevSentence} aria-label={t.prevSentence}>
          <IconSkipBack />
        </button>
        <button className="ctrl-btn play-pause-btn" onClick={isPlaying ? pause : play} title={isPlaying ? t.pauseTitle : t.playTitle} aria-label={isPlaying ? t.pauseTitle : t.playTitle}>
          {isPlaying ? <IconPause /> : <IconPlay />}
        </button>
        <button className="ctrl-btn" onClick={() => skip(1)} title={t.nextSentence} aria-label={t.nextSentence}>
          <IconSkipForward />
        </button>
        <button
          type="button"
          className={`playing-dots${isPlaying ? ' active' : ''}`}
          onClick={onCenterActive}
          title={t.goToHighlighted}
          aria-label={t.goToHighlighted}
        >
          <span /><span /><span />
        </button>
      </div>
    </div>
  );
}
