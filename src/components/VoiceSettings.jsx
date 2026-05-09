const LANG_NAMES = new Intl.DisplayNames([navigator.language, 'en'], { type: 'language' });

function getLangLabel(langTag) {
  try { return LANG_NAMES.of(langTag); } catch { return langTag; }
}

function groupVoicesByLang(voices) {
  const deviceLang = navigator.language.split('-')[0].toLowerCase();
  const map = new Map();

  for (const v of voices) {
    const base = v.lang.split('-')[0].toLowerCase();
    if (!map.has(base)) map.set(base, []);
    map.get(base).push(v);
  }

  // Order: device lang first, English second (if not device), rest alphabetically
  const keys = [...map.keys()];
  const priority = [deviceLang, 'en'].filter((l, i, a) => a.indexOf(l) === i);
  const rest = keys.filter(k => !priority.includes(k)).sort();
  const ordered = [...priority.filter(k => map.has(k)), ...rest];

  return ordered.map(base => ({
    base,
    label: getLangLabel(base),
    voices: map.get(base),
  }));
}

export default function VoiceSettings({ voices, selectedVoice, setSelectedVoice, rate, setRate, pitch, setPitch, volume, setVolume }) {
  const groups = groupVoicesByLang(voices);

  return (
    <div className="voice-settings">
      <div className="setting-row">
        <label className="setting-label">Voce</label>
        <select
          className="voice-select"
          value={selectedVoice?.name || ''}
          onChange={e => setSelectedVoice(voices.find(v => v.name === e.target.value) || null)}
        >
          {groups.map(({ base, label, voices: groupVoices }) => (
            <optgroup key={base} label={label}>
              {groupVoices.map(v => (
                <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="sliders">
        <div className="slider-row">
          <label className="slider-label">
            <span>Velocità</span>
            <span className="slider-value">{rate.toFixed(1)}×</span>
          </label>
          <input type="range" min="0.5" max="2" step="0.1" value={rate}
            onChange={e => setRate(parseFloat(e.target.value))} />
        </div>

        <div className="slider-row">
          <label className="slider-label">
            <span>Tono</span>
            <span className="slider-value">{pitch.toFixed(1)}</span>
          </label>
          <input type="range" min="0" max="2" step="0.1" value={pitch}
            onChange={e => setPitch(parseFloat(e.target.value))} />
        </div>

        <div className="slider-row">
          <label className="slider-label">
            <span>Volume</span>
            <span className="slider-value">{Math.round(volume * 100)}%</span>
          </label>
          <input type="range" min="0" max="1" step="0.05" value={volume}
            onChange={e => setVolume(parseFloat(e.target.value))} />
        </div>
      </div>
    </div>
  );
}
