import { useEffect, useMemo } from 'react';
import { hashText } from '../utils/hash';

const TEXT_KEY = 'tts_last_text';

export function usePersistence({ text, chunkIndex, chunks }) {
  // Save text with 500ms debounce
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => {
      localStorage.setItem(TEXT_KEY, text);
    }, 500);
    return () => clearTimeout(timer);
  }, [text]);

  // Save position on every chunk change
  useEffect(() => {
    if (!text || !chunks || chunks.length === 0) return;
    const key = hashText(text);
    const pct = Math.round((chunkIndex / chunks.length) * 100);
    localStorage.setItem(key, JSON.stringify({ index: chunkIndex, pct }));
  }, [chunkIndex, text, chunks]);

  // savedPosition is freshly computed whenever text changes
  const savedPosition = useMemo(() => {
    if (!text) return null;
    const key = hashText(text);
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  return { savedPosition };
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
