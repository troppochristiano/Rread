import { useCallback, useEffect, useState } from 'react';
import { hashText } from '../utils/hash';

const LIBRARY_KEY = 'tts_library';
const SELECTED_KEY = 'tts_library_selected';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(items) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(items));
  } catch {
    // Quota or serialization failure — swallow; UI state still reflects intent.
  }
}

function deriveTitle(text) {
  const snippet = text.trim().split(/\s+/).slice(0, 8).join(' ');
  return snippet ? snippet.slice(0, 80) : '';
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function useLibrary() {
  const [items, setItems] = useState(loadFromStorage);
  const [selectedId, _setSelectedId] = useState(() => localStorage.getItem(SELECTED_KEY) || null);

  const setSelectedId = useCallback((id) => {
    _setSelectedId(id);
    if (id) localStorage.setItem(SELECTED_KEY, id);
    else localStorage.removeItem(SELECTED_KEY);
  }, []);

  // Re-sync if another tab edits the library.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === LIBRARY_KEY) setItems(loadFromStorage());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const save = useCallback((text, customTitle) => {
    const trimmed = text?.trim();
    if (!trimmed) return null;
    const title = (customTitle && customTitle.trim()) || deriveTitle(trimmed) || 'Untitled';
    const now = Date.now();
    const entry = {
      id: makeId(),
      title,
      text,
      hash: hashText(text),
      createdAt: now,
      updatedAt: now,
    };
    setItems((prev) => {
      const next = [entry, ...prev];
      persist(next);
      return next;
    });
    return entry.id;
  }, []);

  const create = useCallback((text = '', customTitle) => {
    const safe = text || '';
    const title = (customTitle && customTitle.trim()) || deriveTitle(safe) || '';
    const now = Date.now();
    const entry = {
      id: makeId(),
      title,
      text: safe,
      hash: hashText(safe),
      createdAt: now,
      updatedAt: now,
    };
    setItems((prev) => {
      const next = [entry, ...prev];
      persist(next);
      return next;
    });
    return entry.id;
  }, []);

  const remove = useCallback((id) => {
    setItems((prev) => {
      const next = prev.filter((it) => it.id !== id);
      persist(next);
      return next;
    });
    _setSelectedId((cur) => {
      if (cur === id) {
        localStorage.removeItem(SELECTED_KEY);
        return null;
      }
      return cur;
    });
  }, []);

  const rename = useCallback((id, title) => {
    const trimmed = (title || '').trim();
    if (!trimmed) return;
    setItems((prev) => {
      const next = prev.map((it) =>
        it.id === id ? { ...it, title: trimmed.slice(0, 80), updatedAt: Date.now() } : it,
      );
      persist(next);
      return next;
    });
  }, []);

  const update = useCallback((id, text) => {
    const trimmed = text?.trim();
    if (!trimmed) return;
    setItems((prev) => {
      const next = prev.map((it) =>
        it.id === id ? { ...it, text, hash: hashText(text), updatedAt: Date.now() } : it,
      );
      persist(next);
      return next;
    });
  }, []);

  return { items, save, create, remove, rename, update, selectedId, setSelectedId };
}

export function getPositionForHash(hash) {
  if (!hash) return null;
  try {
    const raw = localStorage.getItem(hash);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
