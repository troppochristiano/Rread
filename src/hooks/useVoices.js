import { useState, useEffect, useCallback, useRef } from 'react';

const STORAGE_KEY = 'tts_voice';
const PROBE_CACHE_KEY = 'tts_voice_probe_v2';
const PROBE_FULL_FLAG_KEY = 'tts_voice_probe_full_v1';
const PROBE_TIMEOUT_MS = 1500;
const PROBE_YIELD_MS = 150;
const PROBE_MAX_RUNTIME_MS = 45_000;

function sortVoices(voices) {
  const lang = navigator.language.split('-')[0].toLowerCase();
  const sameLang = (v) => v.lang.toLowerCase().startsWith(lang);
  const local = voices.filter((v) => sameLang(v) && v.localService);
  const localRemote = voices.filter((v) => sameLang(v) && !v.localService);
  const otherLocal = voices.filter((v) => !sameLang(v) && v.localService);
  const otherRemote = voices.filter((v) => !sameLang(v) && !v.localService);
  return [...local, ...localRemote, ...otherLocal, ...otherRemote];
}

// Voices the auto-probe targets on load: only the device language plus
// English. Engines like Edge expose hundreds of cloud voices in dozens of
// languages — probing all of them would take minutes. The reprobe button
// covers everything when the user explicitly asks for it.
function pickAutoProbeVoices(voices) {
  const lang = navigator.language.split('-')[0].toLowerCase();
  const langs = new Set([lang, 'en']);
  return voices.filter((v) => langs.has(v.lang.toLowerCase().split('-')[0]));
}

function voiceKey(v) {
  return `${v.voiceURI || v.name}|${v.lang}`;
}

function loadProbeCache() {
  try {
    return JSON.parse(localStorage.getItem(PROBE_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveProbeCache(cache) {
  try {
    localStorage.setItem(PROBE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota errors
  }
}

function getFullProbeFlag() {
  try {
    return localStorage.getItem(PROBE_FULL_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

function setFullProbeFlag(on) {
  try {
    if (on) localStorage.setItem(PROBE_FULL_FLAG_KEY, '1');
    else localStorage.removeItem(PROBE_FULL_FLAG_KEY);
  } catch {
    // ignore
  }
}

function probeVoice(voice, isUserSpeechActive) {
  return new Promise((resolve) => {
    let settled = false;
    const start = performance.now();
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(watcher);
      // If the user has triggered speech (playback or voice preview), their
      // utterance may already be queued behind ours — calling cancel() would
      // wipe it. Skip the cancel in that case.
      const userActive = isUserSpeechActive();
      if (!userActive) {
        try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      }
      // If we noticed user speech during the probe, demote the result so
      // the caller knows to retry this voice instead of recording it.
      resolve({ result: userActive ? 'abort' : result, ms: performance.now() - start });
    };
    const u = new SpeechSynthesisUtterance('hi');
    u.voice = voice;
    u.lang = voice.lang;
    u.volume = 0;
    u.rate = 2;
    u.onstart = () => finish('ok');
    u.onend = () => finish('ok');
    u.onerror = (e) => {
      // External cancellation (typically the user starting playback or a
      // voice preview) — don't record this voice as broken on that basis.
      if (e.error === 'canceled' || e.error === 'interrupted') {
        finish('abort');
      } else {
        finish('broken');
      }
    };
    const timer = setTimeout(() => finish('broken'), PROBE_TIMEOUT_MS);
    // Fast-path: catch user speech that starts before any utterance event
    // has had a chance to fire.
    const watcher = setInterval(() => {
      if (isUserSpeechActive()) finish('abort');
    }, 80);
    try {
      window.speechSynthesis.speak(u);
    } catch {
      finish('broken');
    }
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function useVoices() {
  const [allVoices, setAllVoices] = useState([]);
  const [brokenSet, setBrokenSet] = useState(() => {
    const cache = loadProbeCache();
    return new Set(
      Object.entries(cache)
        .filter(([, v]) => v === 'broken')
        .map(([k]) => k),
    );
  });
  const [selectedVoice, setSelectedVoiceState] = useState(null);
  const [isProbing, setIsProbing] = useState(false);
  const [probeProgress, setProbeProgress] = useState({ done: 0, total: 0 });
  const cancelRef = useRef(null);
  const userPlayingRef = useRef(false);
  const previewActiveRef = useRef(false);
  const isUserSpeechActive = useCallback(
    () => userPlayingRef.current || previewActiveRef.current,
    [],
  );

  const setUserPlaying = useCallback((playing) => {
    userPlayingRef.current = !!playing;
  }, []);

  const setPreviewActive = useCallback((active) => {
    previewActiveRef.current = !!active;
  }, []);

  useEffect(() => {
    function load() {
      const raw = window.speechSynthesis.getVoices();
      if (!raw.length) return;
      const sorted = sortVoices(raw);
      setAllVoices(sorted);

      const cache = loadProbeCache();
      const visible = sorted.filter((v) => cache[voiceKey(v)] !== 'broken');
      const saved = localStorage.getItem(STORAGE_KEY);
      const match = saved ? visible.find((v) => v.name === saved) : null;
      setSelectedVoiceState((prev) => prev || match || visible[0] || null);
    }

    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const runProbe = useCallback(async (voicesToProbe, { unbounded = false } = {}) => {
    if (!voicesToProbe.length) return;
    if (cancelRef.current) cancelRef.current.cancelled = true;
    const token = { cancelled: false };
    cancelRef.current = token;

    setIsProbing(true);
    setProbeProgress({ done: 0, total: voicesToProbe.length });

    const cache = loadProbeCache();
    const startedAt = Date.now();
    const sessionResults = [];

    try {
      let i = 0;
      while (i < voicesToProbe.length) {
        if (token.cancelled) return;
        if (!unbounded && Date.now() - startedAt > PROBE_MAX_RUNTIME_MS) break;

        // Pause while the user is using the speech queue (playback or
        // voice preview). Resume from this voice once they stop. The
        // runtime cap is unbounded during pause so we don't bail just
        // because the user listened or previewed for a long time.
        if (isUserSpeechActive()) {
          while (isUserSpeechActive()) {
            await sleep(300);
            if (token.cancelled) return;
          }
          // After resume, give the engine a moment to drain.
          await sleep(PROBE_YIELD_MS);
          if (token.cancelled) return;
        }

        // Wait for anything else still in the queue (typically nothing).
        while (
          window.speechSynthesis.speaking ||
          window.speechSynthesis.pending
        ) {
          if (isUserSpeechActive()) break; // user just started — loop will pause
          await sleep(PROBE_YIELD_MS);
          if (token.cancelled) return;
          if (!unbounded && Date.now() - startedAt > PROBE_MAX_RUNTIME_MS) return;
        }
        if (isUserSpeechActive()) continue;

        const v = voicesToProbe[i];
        const { result, ms } = await probeVoice(v, isUserSpeechActive);
        if (token.cancelled) return;

        // If the user interrupted the probe, don't record a result —
        // retry this voice on the next iteration once they stop.
        if (result === 'abort') continue;

        sessionResults.push({ key: voiceKey(v), result, ms });
        cache[voiceKey(v)] = result;
        saveProbeCache(cache);

        setBrokenSet((prev) => {
          const next = new Set(prev);
          if (result === 'broken') next.add(voiceKey(v));
          else next.delete(voiceKey(v));
          return next;
        });
        setProbeProgress({ done: i + 1, total: voicesToProbe.length });
        i++;
      }

      // Reached the end of the batch cleanly — if this was a full reprobe,
      // clear the persisted "in progress" flag so future loads use the
      // normal auto-probe behaviour.
      if (unbounded && !token.cancelled && i === voicesToProbe.length) {
        setFullProbeFlag(false);
      }

      // Safety net: only roll back when the browser clearly blocked synthesis
      // outright — every probe failed AND failed near-instantly (<100ms avg).
      // A normal "voice is broken" timeout takes the full ~1.5s, so we keep
      // those results.
      if (sessionResults.length >= 5) {
        const okCount = sessionResults.filter((r) => r.result === 'ok').length;
        const avgMs =
          sessionResults.reduce((s, r) => s + r.ms, 0) / sessionResults.length;
        if (okCount === 0 && avgMs < 100) {
          for (const r of sessionResults) delete cache[r.key];
          saveProbeCache(cache);
          setBrokenSet((prev) => {
            const next = new Set(prev);
            for (const r of sessionResults) next.delete(r.key);
            return next;
          });
        }
      }
    } finally {
      if (!token.cancelled) {
        setIsProbing(false);
        setProbeProgress({ done: 0, total: 0 });
      }
    }
  }, []);

  // Auto-probe any new (uncached) voices on load. Default scope is the
  // device language + English; engines like Edge expose hundreds of cloud
  // voices and probing them all on every load would be impractical. If a
  // previous full reprobe was interrupted (e.g. by a reload), the persisted
  // flag tells us to resume probing every uncached voice instead.
  useEffect(() => {
    if (!allVoices.length) return;
    const cache = loadProbeCache();
    const resumeFull = getFullProbeFlag();
    const candidates = resumeFull
      ? allVoices
      : pickAutoProbeVoices(allVoices);
    const todo = candidates.filter((v) => !(voiceKey(v) in cache));
    if (!todo.length) {
      if (resumeFull) setFullProbeFlag(false);
      return;
    }
    runProbe(todo, { unbounded: resumeFull });
  }, [allVoices, runProbe]);

  const reprobe = useCallback(() => {
    if (!allVoices.length) return;
    try {
      localStorage.removeItem(PROBE_CACHE_KEY);
    } catch {
      // ignore
    }
    // Mark the full reprobe as in progress so we resume it across reloads.
    setFullProbeFlag(true);
    setBrokenSet(new Set());
    // User-initiated: probe every voice and skip the runtime cap.
    runProbe(allVoices, { unbounded: true });
  }, [allVoices, runProbe]);

  const voices = allVoices.filter((v) => !brokenSet.has(voiceKey(v)));

  useEffect(() => {
    if (selectedVoice && brokenSet.has(voiceKey(selectedVoice))) {
      setSelectedVoiceState(voices[0] || null);
    }
  }, [brokenSet, selectedVoice, voices]);

  const setSelectedVoice = useCallback((voice) => {
    setSelectedVoiceState(voice);
    if (voice) localStorage.setItem(STORAGE_KEY, voice.name);
  }, []);

  return {
    voices,
    selectedVoice,
    setSelectedVoice,
    isProbing,
    probeProgress,
    reprobe,
    setUserPlaying,
    setPreviewActive,
  };
}
