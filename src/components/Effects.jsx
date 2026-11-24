import { useEffect, useState } from 'react';
import { EASES, KINDS, customId, isCustom, library, onLibrary, transitionLibrary } from '../lib/anims.js';
import { TRANSITIONS, W, H } from '../lib/deck.js';
import { BUILT_IN, DEFAULT_FX, KIND_NAMES, actsOf, geomOf, slideSteps, triggerSteps } from '../lib/effects.js';

// The Animations and Transition sections of the inspector.

const TYPE = { text: 'Text', rect: 'Box', ellipse: 'Circle', image: 'Picture', line: 'Line' };
const nameOf = (e, self) => (e === self ? 'this object' : `“${(e.type === 'text' && String(e.text || '').trim().split('\n')[0].slice(0, 24)) || TYPE[e.type] || 'Shape'}”`);
const nth = n => (n === 1 ? '' : ` (${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} time)`);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function Num({ label, value, min, max, step = 1, onChange, unit }) {
  return (
    <label className="field"><span>{label}</span>
      <input type="number" min={min} max={max} step={step} value={value} onChange={e => onChange(clamp(+e.target.value || 0, min, max))} />
      {unit && <em className="unit">{unit}</em>}
    </label>
  );
}

// When an action plays: 's:<n>' with the slide (0) or on its nth click; 't:<id>:<n>' on the nth click of an object.
function Starts({ slide, el, act, without, onChange }) {
  const clicks = slideSteps(without);
  const value = act.on ? `t:${act.on}:${act.step || 1}` : `s:${act.step || 0}`;
  const objects = slide.els.filter(e => e.type);
  const known = !act.on || objects.some(e => e.id === act.on);
  return (
    <label className="field"><span>Starts</span>
      <select value={value} onChange={e => {
        const [kind, a, b] = e.target.value.split(':');
        onChange(kind === 's' ? { on: undefined, step: +a } : { on: a, step: +b });
      }}>
        <option value="s:0">With the slide</option>
        {Array.from({ length: Math.max(clicks + 1, act.on ? 0 : act.step || 0) }, (_, n) => <option key={n} value={`s:${n + 1}`}>On click {n + 1}</option>)}
        <optgroup label="When an object is clicked">
          {objects.flatMap(o => {
            const n = triggerSteps(without, o.id) + 1, top = Math.max(n, act.on === o.id ? act.step || 1 : 0);
            return Array.from({ length: top }, (_, k) => <option key={`${o.id}${k}`} value={`t:${o.id}:${k + 1}`}>When {nameOf(o, el)} is clicked{nth(k + 1)}</option>);
          })}
        </optgroup>
        {!known && <option value={value}>When a removed object is clicked (never)</option>}
      </select>
    </label>
  );
}

// The effect of one action: built in, custom in this deck, from My animations, or a new one.
function EffectPick({ deck, act, at, lib, actions, onChange }) {
  const kind = act.kind, entrance = at === 'entrance';
  if (kind === 'move') {
    return (
      <label className="field"><span>Easing</span>
        <select value={act.fx in EASES ? act.fx : 'ease-in-out'} onChange={e => onChange({ fx: e.target.value })}>
          {Object.entries(EASES).map(([k, [name]]) => <option key={k} value={k}>{name}</option>)}
        </select>
      </label>
    );
  }
  const fits = a => a.kind === kind || (entrance && a.kind === 'emphasis');
  const mine = Object.entries(deck.anims || {}).filter(([, a]) => fits(a));
  const fromLib = Object.entries(lib).filter(([id, a]) => fits(a) && !deck.anims?.[id]);
  const own = isCustom(act.fx) ? deck.anims?.[customId(act.fx)] : null;
  const choose = v => {
    if (v === 'new') return actions.editAnim(null, { at, kind });
    if (v.startsWith('lib:')) return actions.useAnim(v.slice(4), at);
    onChange({ fx: v, ...(isCustom(v) && deck.anims?.[customId(v)] && { dur: deck.anims[customId(v)].dur }) });
  };
  return <>
    <label className="field"><span>Effect</span>
      <select value={act.fx} onChange={e => choose(e.target.value)}>
        <optgroup label="Built in">{Object.entries(BUILT_IN[kind]).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</optgroup>
        {mine.length > 0 && <optgroup label="Custom, in this deck">{mine.map(([id, a]) => <option key={id} value={`custom:${id}`}>{a.name}{a.kind !== kind ? ` (${KINDS[a.kind]})` : ''}</option>)}</optgroup>}
        {fromLib.length > 0 && <optgroup label="My animations">{fromLib.map(([id, a]) => <option key={id} value={`lib:${id}`}>{a.name}</option>)}</optgroup>}
        {isCustom(act.fx) && !own && <option value={act.fx}>Missing custom animation (plays a fade)</option>}
        <option value="new">New custom {KIND_NAMES[kind].toLowerCase()}…</option>
      </select>
    </label>
    {own && <button onClick={() => actions.editAnim(customId(act.fx), { at, kind })}>Edit “{own.name}”…</button>}
  </>;
}

// Everything the selected object does while presenting: its entrance (el.anim) and its later
// actions (el.acts): emphasis, exit, move to a place, enter again. Each one starts with the slide,
// on a click, or when an object on the slide is clicked (a trigger).
export function Animations({ deck, slide, el, setEl, actions }) {
  const [lib, setLib] = useState(library);
  useEffect(() => onLibrary(() => setLib(library())), []);
  const acts = el.acts || [];
  const list = [...(el.anim?.fx ? [{ a: actsOf(deck, el)[0], at: 'entrance' }] : []), ...acts.map((a, i) => ({ a, at: i }))];

  // The slide without action `at` of this object: what the Starts choices count.
  const without = at => ({ els: slide.els.map(e => (e !== el ? e : at === 'entrance' ? { ...e, anim: undefined } : { ...e, acts: acts.filter((_, i) => i !== at) })) });
  const write = (at, patch) => {
    if (at === 'entrance') return setEl('anim', patch === null ? undefined : clean({ ...el.anim, ...patch }));
    const next = acts.map((x, i) => (i === at ? clean({ ...x, ...patch }) : x)).filter((x, i) => !(i === at && patch === null));
    setEl('acts', next.length ? next : undefined);
  };
  const clean = x => { const c = { ...x }; for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k]; if (c.on) c.step = Math.max(1, c.step || 1); return c; };
  const swap = (i, d) => {
    const next = [...acts], j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setEl('acts', next);
  };
  function add(kind) {
    const step = slideSteps(slide) + 1;
    if (kind === 'entrance') return setEl('anim', { fx: DEFAULT_FX.in, step, dur: 0.5 });
    const made = { kind, fx: DEFAULT_FX[kind], step, dur: kind === 'move' ? 1 : 0.6 };
    if (kind === 'move') {
      const last = [...acts].reverse().find(x => x.kind === 'move' && x.to)?.to || geomOf(el);
      const dx = last.x + last.w + 300 <= W ? 300 : -300;
      made.to = { ...last, x: Math.round(last.x + dx), rot: last.rot || 0 };
    }
    setEl('acts', [...acts, made]);
  }

  return (
    <>
      <h3>Animations</h3>
      {!list.length && <p className="hint">Nothing yet. Add an entrance, emphasis, exit or move, then choose when it plays: with the slide, on a click, or when you click another object.</p>}
      {list.map(({ a, at }, n) => (
        <div className="act" key={`${at}`}>
          <div className="actHead">
            <b>{n + 1}. {a.entrance ? (a.kind === 'emphasis' ? 'Emphasis' : 'Entrance') : KIND_NAMES[a.kind]}</b>
            <span className="grow" />
            {at !== 'entrance' && <>
              <button className="icon" title="Earlier" aria-label="Move earlier" disabled={at === 0} onClick={() => swap(at, -1)}>↑</button>
              <button className="icon" title="Later" aria-label="Move later" disabled={at === acts.length - 1} onClick={() => swap(at, 1)}>↓</button>
            </>}
            <button className="icon" title="Play this" aria-label="Preview" onClick={() => actions.previewBuild(a.on ? { on: a.on, step: a.step || 1 } : a.step || 0)}>▶</button>
            <button className="icon" title="Remove" aria-label="Remove" onClick={() => write(at, null)}>×</button>
          </div>
          <EffectPick deck={deck} act={a} at={at} lib={lib} actions={actions} onChange={p => write(at, p)} />
          <Starts slide={slide} el={el} act={a} without={without(at)} onChange={p => write(at, p)} />
          {a.fx !== 'appear' && a.fx !== 'out-vanish' && <Num label="Duration" value={a.dur ?? 0.5} min={0.05} max={30} step={0.1} unit="s" onChange={v => write(at, { dur: v })} />}
          <Num label="Delay" value={a.delay || 0} min={0} max={60} step={0.1} unit="s" onChange={v => write(at, { delay: v || undefined })} />
          {a.kind === 'move' && <MoveTo to={a.to || geomOf(el)} onChange={to => write(at, { to })} onDrag={() => actions.recordMove(at)} />}
        </div>
      ))}
      <label className="field"><span>Add</span>
        <select value="" onChange={e => { if (e.target.value) add(e.target.value); }}>
          <option value="">Add animation…</option>
          {!el.anim?.fx && <option value="entrance">Entrance</option>}
          <option value="emphasis">Emphasis</option>
          <option value="out">Exit</option>
          <option value="move">Move to…</option>
          {el.anim?.fx && <option value="in">Enter again</option>}
        </select>
      </label>
    </>
  );
}

// Where a Move takes the object, in slide units (the slide is 1600 × 900).
function MoveTo({ to, onChange, onDrag }) {
  const set = (k, v) => onChange({ ...to, [k]: v });
  return <>
    <div className="moveFields">
      <Num label="X" value={Math.round(to.x)} min={-W} max={W * 2} onChange={v => set('x', v)} />
      <Num label="Y" value={Math.round(to.y)} min={-H} max={H * 2} onChange={v => set('y', v)} />
      <Num label="Width" value={Math.round(to.w)} min={1} max={W * 3} onChange={v => set('w', v)} />
      <Num label="Height" value={Math.round(to.h)} min={1} max={H * 3} onChange={v => set('h', v)} />
      <Num label="Rotate" value={to.rot || 0} min={-3600} max={3600} unit="°" onChange={v => set('rot', v)} />
    </div>
    <button onClick={onDrag}>Set by dragging on the slide…</button>
  </>;
}

// The slide's transition: built in, custom in this deck, from My transitions, or a new one.
export function Transition({ deck, slide, setSlide, actions }) {
  const [lib, setLib] = useState(transitionLibrary.read);
  useEffect(() => transitionLibrary.onChange(() => setLib(transitionLibrary.read())), []);
  const t = slide.trans || { fx: 'none', dur: 0.6 };
  const mine = Object.entries(deck.transitions || {});
  const fromLib = Object.entries(lib).filter(([id]) => !deck.transitions?.[id]);
  const own = isCustom(t.fx) ? deck.transitions?.[customId(t.fx)] : null;
  const choose = v => {
    if (v === 'none') return setSlide('trans', undefined);
    if (v === 'new') return actions.editTransition(null);
    if (v.startsWith('lib:')) return actions.useTransition(v.slice(4));
    setSlide('trans', { ...t, fx: v, ...(isCustom(v) && deck.transitions?.[customId(v)] && { dur: deck.transitions[customId(v)].dur }) });
  };
  return (
    <>
      <h3>Transition</h3>
      <label className="field"><span>Effect</span>
        <select value={t.fx} onChange={e => choose(e.target.value)}>
          <optgroup label="Built in">{Object.entries(TRANSITIONS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</optgroup>
          {mine.length > 0 && <optgroup label="Custom, in this deck">{mine.map(([id, x]) => <option key={id} value={`custom:${id}`}>{x.name}</option>)}</optgroup>}
          {fromLib.length > 0 && <optgroup label="My transitions">{fromLib.map(([id, x]) => <option key={id} value={`lib:${id}`}>{x.name}</option>)}</optgroup>}
          {isCustom(t.fx) && !own && <option value={t.fx}>Missing custom transition (plays a fade)</option>}
          <option value="new">New custom transition…</option>
        </select>
      </label>
      {own && <button onClick={() => actions.editTransition(customId(t.fx))}>Edit “{own.name}”…</button>}
      {t.fx !== 'none' && <>
        <Num label="Duration" value={t.dur} min={0.1} max={30} step={0.1} unit="s" onChange={v => setSlide('trans', { ...t, dur: v })} />
        {t.fx === 'morph' && <p className="hint">Objects that are on the previous slide too (same text, picture or shape) glide to their new place. Duplicate a slide, move things, then pick Morph.</p>}
        <div className="row">
          <button onClick={actions.preview}>Preview</button>
          <button onClick={() => actions.transitionAll(slide.trans)}>Use on all slides</button>
        </div>
      </>}
    </>
  );
}
