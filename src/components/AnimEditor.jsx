import { useEffect, useRef, useState } from 'react';
import {
  EASES, KINDS, PRESETS, PROPS, cleanAnim, easeCss, importLibrary, keyframeName, keyframesCss,
  library, libraryFile, newAnimId, onLibrary, removeFromLibrary,
} from '../lib/anims.js';
import { saveFile } from '../lib/files.js';
import Modal from './Modal.jsx';

const PREVIEW_ID = 'preview';
const blankFrame = at => ({ at });

// Make or change a custom animation: keyframes, timing and a live preview, saved to the deck
// and (optionally) to My animations. `start` is { id, anim } to edit, or null for a new one.
// onSave(id, anim, { library }) puts it in the deck (and on the selected object, if any).
export default function AnimEditor({ start, sample, onSave, onClose }) {
  const [id] = useState(() => start?.id || newAnimId());
  const [anim, setAnim] = useState(() => structuredClone(start?.anim || PRESETS.rise));
  const [toLibrary, setToLibrary] = useState(() => !start || Boolean(library()[start.id]));
  const [lib, setLib] = useState(library);
  const [play, setPlay] = useState(0);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const fileInput = useRef(null);
  useEffect(() => onLibrary(() => setLib(library())), []);

  const clean = cleanAnim(anim);
  useEffect(() => { const t = setTimeout(() => setPlay(p => p + 1), 250); return () => clearTimeout(t); }, [JSON.stringify(clean)]);   // replay after each change

  const set = patch => setAnim(a => ({ ...a, ...patch }));
  const setFrame = (i, key, value) => setAnim(a => ({
    ...a, frames: a.frames.map((f, n) => {
      if (n !== i) return f;
      const next = { ...f };
      if (value === '' || value == null) delete next[key]; else next[key] = +value;
      return next;
    }),
  }));
  const addFrame = () => setAnim(a => {
    const f = [...a.frames].sort((p, q) => p.at - q.at);
    const gap = f.reduce((best, x, n) => (n && x.at - f[n - 1].at > best.size ? { size: x.at - f[n - 1].at, at: (x.at + f[n - 1].at) / 2 } : best), { size: 0, at: 50 });
    return { ...a, frames: [...f, blankFrame(Math.round(gap.at))].sort((p, q) => p.at - q.at) };
  });
  const removeFrame = i => setAnim(a => ({ ...a, frames: a.frames.filter((_, n) => n !== i) }));

  function save() {
    if (!clean) return setError('An animation needs at least two keyframes, each with a time from 0 to 100%.');
    try { onSave(id, clean, { library: toLibrary }); }
    catch (err) { setError(err.message); }
  }
  async function exportLib() {
    setError('');
    try { const r = await saveFile('my-animations.json', libraryFile(), 'application/json', [{ name: 'Waypoint animations', extensions: ['json'] }]); if (r) setNote(`Saved ${Object.keys(lib).length} animations.`); }
    catch (err) { setError(err.message); }
  }
  async function importLib(file) {
    setError(''); setNote('');
    if (!file) return;
    if (file.size > 2e6) return setError('That file is too large to be an animations file.');
    try { setNote(`Added ${importLibrary(await file.text())} animations to My animations.`); }
    catch (err) { setError(err.message); }
  }

  const frames = anim.frames.map((f, i) => ({ f, i }));
  return (
    <Modal title={start ? 'Edit animation' : 'New animation'} onClose={onClose} wide>
      <div className="form animEditor">
        <div className="animTop">
          <div className="animFields">
            <label>Name<input value={anim.name} maxLength={60} onChange={e => set({ name: e.target.value })} /></label>
            <div className="cols">
              <label className="grow">Kind
                <select value={anim.kind} onChange={e => set({ kind: e.target.value })}>
                  {Object.entries(KINDS).map(([k, name]) => <option key={k} value={k}>{name}</option>)}
                </select>
              </label>
              <label className="grow">Duration (s)<input type="number" min={0.1} max={30} step={0.1} value={anim.dur} onChange={e => set({ dur: +e.target.value })} /></label>
              <label className="grow">Easing
                <select value={anim.ease} onChange={e => set({ ease: e.target.value })}>
                  {Object.entries(EASES).map(([k, [name]]) => <option key={k} value={k}>{name}</option>)}
                </select>
              </label>
            </div>
            <p className="dim">
              {anim.kind === 'emphasis'
                ? 'Emphasis: the object stays on the slide and plays when its build comes up.'
                : 'Entrance: the object is hidden until its build comes up, then plays in.'}{' '}
              Empty boxes mean “as placed on the slide”.
            </p>
            <label>Start from
              <select value="" onChange={e => { const p = PRESETS[e.target.value] || lib[e.target.value]; if (p) setAnim({ ...structuredClone(p), name: anim.name === PRESETS.rise.name || !anim.name ? p.name : anim.name }); }}>
                <option value="">Choose a preset…</option>
                <optgroup label="Presets">{Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.name} ({KINDS[p.kind]})</option>)}</optgroup>
                {Object.keys(lib).length > 0 && <optgroup label="My animations">{Object.entries(lib).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}</optgroup>}
              </select>
            </label>
          </div>
          <Preview anim={clean} play={play} sample={sample} onReplay={() => setPlay(p => p + 1)} />
        </div>

        <div className="frames" role="table" aria-label="Keyframes">
          <div className="frow head" role="row">
            <span role="columnheader">At %</span>
            {Object.entries(PROPS).map(([k, [label, , , , unit]]) => <span key={k} role="columnheader">{label}{unit && ` (${unit})`}</span>)}
            <span />
          </div>
          {frames.map(({ f, i }) => (
            <div className="frow" role="row" key={i}>
              <input type="number" aria-label="At percent" min={0} max={100} step={1} value={f.at} onChange={e => setFrame(i, 'at', e.target.value === '' ? 0 : e.target.value)} />
              {Object.entries(PROPS).map(([k, [label, min, max, , ]]) => (
                <input key={k} type="number" aria-label={label} min={min} max={max} step={k === 'opacity' || k === 'scale' ? 0.05 : 1} value={f[k] ?? ''} placeholder="–" onChange={e => setFrame(i, k, e.target.value)} />
              ))}
              <button className="x" title="Remove keyframe" aria-label="Remove keyframe" disabled={anim.frames.length <= 2} onClick={() => removeFrame(i)}>×</button>
            </div>
          ))}
          <button className="link" onClick={addFrame} disabled={anim.frames.length >= 12}>Add keyframe</button>
        </div>

        <label className="check"><input type="checkbox" checked={toLibrary} onChange={e => setToLibrary(e.target.checked)} /> Also save to My animations, to use in other decks</label>

        <details className="libBox">
          <summary>My animations ({Object.keys(lib).length})</summary>
          {Object.keys(lib).length === 0 && <p className="dim">Animations you save appear here.</p>}
          <ul>
            {Object.entries(lib).map(([k, a]) => (
              <li key={k}>
                <span className="grow">{a.name} <span className="dim">· {KINDS[a.kind]}, {a.dur}s</span></span>
                <button onClick={() => setAnim(structuredClone(a))}>Load</button>
                <button onClick={() => removeFromLibrary(k)}>Delete</button>
              </li>
            ))}
          </ul>
          <div className="row">
            <button onClick={exportLib} disabled={!Object.keys(lib).length}>Export to a file…</button>
            <button onClick={() => fileInput.current?.click()}>Import from a file…</button>
            <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => { importLib(e.target.files[0]); e.target.value = ''; }} />
          </div>
        </details>
        {note && <p className="status">{note}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <footer>
        <span className="grow" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={save}>{sample ? 'Save and use' : 'Save'}</button>
      </footer>
    </Modal>
  );
}

// A small slide that plays the animation on a sample object.
function Preview({ anim, play, sample, onReplay }) {
  return (
    <div className="animPreview">
      <div className="animStage">
        {anim && <style>{keyframesCss({ [PREVIEW_ID]: anim })}</style>}
        <div className="animSlide">
        <div
          key={play}
          className={anim ? 'animSample fx fx-custom' : 'animSample'}
          style={anim ? { '--fx': keyframeName(PREVIEW_ID), animationDuration: `${anim.dur}s`, animationTimingFunction: easeCss(anim) } : undefined}
        >
          {sample || 'Your object'}
        </div>
        </div>
      </div>
      <button onClick={onReplay} disabled={!anim}>Play again</button>
    </div>
  );
}
