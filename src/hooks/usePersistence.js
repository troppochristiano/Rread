import { useEffect, useMemo, useCallback, useRef } from 'react';
import { hashText } from '../utils/hash';

const TEXT_KEY = 'tts_last_text';

export function usePersistence({ text, chunkIndex, chunks }) {
  // Compute once per text change — hashText is O(n) on text length
  const key = useMemo(() => text ? hashText(text) : null, [text]);

  // Save text with 500ms debounce
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => {
      localStorage.setItem(TEXT_KEY, text);
    }, 500);
    return () => clearTimeout(timer);
  }, [text]);

  // Never auto-save chunkIndex=0 — useSpeech initialises there, and
  // React StrictMode mounts twice so a ref-based "skip first run" check
  // is unreliable. Position 0 is cleared explicitly via clearPosition()
  // when the user restarts or playback reaches the natural end.
  // Also skip the run where `key` just changed: chunkIndex is still the
  // previous text's value and would otherwise be written under the new key.
  const prevKeyRef = useRef(null);
  useEffect(() => {
    if (!key || !chunks || chunks.length === 0) return;
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key;
      return;
    }
    if (chunkIndex === 0) return;
    const pct = Math.round((chunkIndex / chunks.length) * 100);
    localStorage.setItem(key, JSON.stringify({ index: chunkIndex, pct }));
  }, [chunkIndex, key, chunks]);

  const clearPosition = useCallback(() => {
    if (key) localStorage.removeItem(key);
  }, [key]);

  return { clearPosition };
}

export function getInitialText() {
  return localStorage.getItem(TEXT_KEY) || '';
}

export function getSavedPositionForText(text) {
  if (!text) return null;
  try {
    const raw = localStorage.getItem(hashText(text));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
