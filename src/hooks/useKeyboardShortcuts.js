import { useEffect, useRef } from 'react';

export function useKeyboardShortcuts({ active, isPlaying, play, pause, skip, stop }) {
  const ref = useRef({});
  ref.current = { isPlaying, play, pause, skip, stop };

  useEffect(() => {
    if (!active) return;
    function onKey(e) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      const { isPlaying: playing, play: p, pause: pa, skip: sk, stop: st } = ref.current;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          playing ? pa() : p();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          sk(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          sk(1);
          break;
        case 'Escape':
          st();
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
