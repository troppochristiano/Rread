import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'tts_voice';

function sortVoices(voices) {
  const lang = navigator.language.split('-')[0].toLowerCase();
  const local = voices.filter(v => v.lang.toLowerCase().startsWith(lang));
  const other = voices.filter(v => !v.lang.toLowerCase().startsWith(lang));
  return [...local, ...other];
}

export function useVoices() {
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoiceState] = useState(null);

  useEffect(() => {
    function load() {
      const raw = window.speechSynthesis.getVoices();
      if (!raw.length) return;
      const sorted = sortVoices(raw);
      setVoices(sorted);

      // Restore persisted voice or fall back to first local voice
      const saved = localStorage.getItem(STORAGE_KEY);
      const match = saved ? sorted.find(v => v.name === saved) : null;
      setSelectedVoiceState(match || sorted[0] || null);
    }

    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  const setSelectedVoice = useCallback((voice) => {
    setSelectedVoiceState(voice);
    if (voice) localStorage.setItem(STORAGE_KEY, voice.name);
  }, []);

  return { voices, selectedVoice, setSelectedVoice };
}
