import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EASES, TPROPS, TRANSITION_PRESETS, cleanTransition, importLibrary, libraryFile, newAnimId, transitionLibrary } from '../lib/anims.js';
import { playTransition } from '../lib/transitions.js';
import { saveFile } from '../lib/files.js';
import SlideView from './SlideView.jsx';
import { FrameTable } from './AnimEditor.jsx';
import Modal from './Modal.jsx';

// Make or change a custom slide transition: what the slide that is leaving does, what the
// arriving slide does, the timing, and a preview between two real slides of the deck.
// `start` is { id, t } to edit, or null for a new one. `a` and `b` are the slides to preview with.
// onSave(id, transition, { library }) puts it in the deck and on the current slide.
export default function TransitionEditor({ start, deck, a, b, onSave, onClose }) {
  const [id] = useState(() => start?.id || newAnimId());
  const [t, setT] = useState(() => structuredClone(start?.t || TRANSITION_PRESETS['slide-up']));
  const [toLibrary, setToLibrary] = useState(() => !start || Boolean(transitionLibrary.read()[start.id]));
  const [lib, setLib] = useState(transitionLibrary.read);
  const [back, setBack] = useState(false);
  const [play, setPlay] = useState(0);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const fileInput = useRef(null), from = useRef(null), to = useRef(null);
  useEffect(() => transitionLibrary.onChange(() => setLib(transitionLibrary.read())), []);

  const clean = cleanTransition(t);
  const key = JSON.stringify(clean);
  useEffect(() => { const k = setTimeout(() => setPlay(p => p + 1), 300); return () => clearTimeout(k); }, [key, back]);   // replay after each change
  useLayoutEffect(() => {
    if (!play || !clean || !from.current || !to.current) return;
    playTransition({ fx: 'custom:preview', custom: clean, dur: clean.dur, dir: back ? -1 : 1, from: from.current, to: to.current });
    return () => { from.current?.getAnimations().forEach(x => x.cancel()); to.current?.getAnimations().forEach(x => x.cancel()); };
  }, [play]);

  const set = patch => setT(x => ({ ...x, ...patch }));
  function save() {
    if (!clean) return setError('Each side needs two or more keyframes (or none, to stay still), with times from 0 to 100%.');
    try { onSave(id, clean, { library: toLibrary }); }
    catch (err) { setError(err.message); }
  }
  async function exportLib() {
    setError('');
    try { const r = await saveFile('my-animations.json', libraryFile(), 'application/json', [{ name: 'Waypoint animations', extensions: ['json'] }]); if (r) setNote('Saved My animations and My transitions.'); }
    catch (err) { setError(err.message); }
  }
  async function importLib(file) {
    setError(''); setNote('');
    if (!file) return;
    if (file.size > 2e6) return setError('That file is too large to be an animations file.');
    try { setNote(`Added ${importLibrary(await file.text())} animations and transitions.`); }
    catch (err) { setError(err.message); }
  }
  const load = p => setT({ ...structuredClone(p), name: Object.values(TRANSITION_PRESETS).some(x => x.name === t.name) || !t.name ? p.name : t.name });

  return (
    <Modal title={start ? 'Edit transition' : 'New transition'} onClose={onClose} wide>
      <div className="form animEditor">
        <div className="animTop">
          <div className="animFields">
            <label>Name<input value={t.name} maxLength={60} onChange={e => set({ name: e.target.value })} /></label>
            <div className="cols">
              <label className="grow">Duration (s)<input type="number" min={0.1} max={30} step={0.1} value={t.dur} onChange={e => set({ dur: +e.target.value })} /></label>
              <label className="grow">Easing
                <select value={t.ease} onChange={e => set({ ease: e.target.value })}>
                  {Object.entries(EASES).map(([k, [name]]) => <option key={k} value={k}>{name}</option>)}
                </select>
              </label>
            </div>
            <p className="dim">The arriving slide is on top of the one leaving. Empty boxes mean “as it is”; going back to a slide, sideways moves and turns are mirrored.</p>
            <label>Start from
              <select value="" onChange={e => { const p = TRANSITION_PRESETS[e.target.value] || lib[e.target.value]; if (p) load(p); }}>
                <option value="">Choose a preset…</option>
                <optgroup label="Presets">{Object.entries(TRANSITION_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}</optgroup>
                {Object.keys(lib).length > 0 && <optgroup label="My transitions">{Object.entries(lib).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}</optgroup>}
              </select>
            </label>
          </div>
          <div className="animPreview">
            <div className="animStage transStage">
              <div className="animSlide">
                <div className="transLayer" ref={from}><SlideView deck={deck} slide={a} build={999} /></div>
                <div className="transLayer" ref={to}><SlideView deck={deck} slide={b} build={0} /></div>
              </div>
            </div>
            <div className="row">
              <button onClick={() => setPlay(p => p + 1)} disabled={!clean}>Play again</button>
              <label className="check"><input type="checkbox" checked={back} onChange={e => setBack(e.target.checked)} /> Going back</label>
            </div>
          </div>
        </div>

        <h4>Slide leaving</h4>
        <FrameTable label="Slide leaving" frames={t.out} props={TPROPS} min={0} onChange={out => set({ out })} />
        <h4>Slide arriving</h4>
        <FrameTable label="Slide arriving" frames={t.in} props={TPROPS} min={0} onChange={inn => set({ in: inn })} />

        <label className="check"><input type="checkbox" checked={toLibrary} onChange={e => setToLibrary(e.target.checked)} /> Also save to My transitions, to use in other decks</label>

        <details className="libBox">
          <summary>My transitions ({Object.keys(lib).length})</summary>
          {Object.keys(lib).length === 0 && <p className="dim">Transitions you save appear here.</p>}
          <ul>
            {Object.entries(lib).map(([k, x]) => (
              <li key={k}>
                <span className="grow">{x.name} <span className="dim">· {x.dur}s</span></span>
                <button onClick={() => setT(structuredClone(x))}>Load</button>
                <button onClick={() => transitionLibrary.remove(k)}>Delete</button>
              </li>
            ))}
          </ul>
          <div className="row">
            <button onClick={exportLib}>Export to a file…</button>
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
        <button className="primary" onClick={save}>Save and use</button>
      </footer>
    </Modal>
  );
}
