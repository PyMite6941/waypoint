// Custom animations: effects people make themselves, kept in the deck so it plays the same
// everywhere, and in a personal library ("My animations") to reuse in other decks.
//
// deck.anims = { id: anim }    an element uses one with el.anim.fx = 'custom:<id>'
// anim = { name, kind: 'in' | 'out' | 'emphasis', dur (seconds), ease, frames: [frame] }
//   in        an entrance: the object is hidden until its moment, then plays in
//   out       an exit: plays from where the object is, then it stays hidden
//   emphasis  the object is showing and plays at its moment (pulse, shake), then is as before
// frame = { at (0-100 %), x, y (slide units), scale, rotate (degrees), opacity (0-1), blur (slide units) }
//   Every value is optional; a missing value means "as placed on the slide".
//
// Animations come from files and from the internet, and become CSS, so cleanAnim keeps only
// known keys and clamped numbers: nothing else can reach the stylesheet.

export const KINDS = { in: 'Entrance', out: 'Exit', emphasis: 'Emphasis' };
export const EASES = {
  'ease-out': ['Ease out', 'ease-out'],
  'ease-in-out': ['Ease in and out', 'ease-in-out'],
  'ease-in': ['Ease in', 'ease-in'],
  linear: ['Steady', 'linear'],
  spring: ['Spring (overshoots)', 'cubic-bezier(.34, 1.56, .64, 1)'],
  snap: ['Snap', 'cubic-bezier(.2, .8, .2, 1)'],
};
// [label, min, max, value on the slide, unit]
export const PROPS = {
  x: ['Move across', -3200, 3200, 0, 'px'],
  y: ['Move down', -1800, 1800, 0, 'px'],
  scale: ['Size', 0, 10, 1, '×'],
  rotate: ['Turn', -3600, 3600, 0, '°'],
  opacity: ['Opacity', 0, 1, 1, ''],
  blur: ['Blur', 0, 200, 0, 'px'],
};
const MAX_FRAMES = 12;

export const isCustom = fx => typeof fx === 'string' && fx.startsWith('custom:');
export const customId = fx => (isCustom(fx) ? fx.slice(7) : null);
export const animOf = (deck, fx) => (isCustom(fx) && deck?.anims?.[customId(fx)]) || null;
export const isEmphasis = (deck, el) => animOf(deck, el.anim?.fx)?.kind === 'emphasis';
const okId = id => typeof id === 'string' && /^[a-z0-9]{1,24}$/i.test(id);
export const newAnimId = () => Math.random().toString(36).slice(2, 10);

const num = (v, min, max) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(+v) ? Math.min(max, Math.max(min, +v)) : undefined;

/** A safe copy of an animation, or null if it is not one. */
export function cleanAnim(a) {
  if (!a || typeof a !== 'object' || !Array.isArray(a.frames)) return null;
  const frames = [];
  for (const f of a.frames.slice(0, MAX_FRAMES)) {
    if (!f || typeof f !== 'object') continue;
    const at = num(f.at, 0, 100);
    if (at === undefined) continue;
    const frame = { at: Math.round(at * 10) / 10 };
    for (const [k, [, min, max]] of Object.entries(PROPS)) { const v = num(f[k], min, max); if (v !== undefined) frame[k] = Math.round(v * 1000) / 1000; }
    frames.push(frame);
  }
  if (frames.length < 2) return null;
  frames.sort((p, q) => p.at - q.at);
  return {
    name: String(a.name || 'Custom animation').replace(/[\u0000-\u001f]/g, '').slice(0, 60) || 'Custom animation',
    kind: a.kind in KINDS ? a.kind : 'in',
    dur: num(a.dur, 0.1, 30) ?? 0.8,
    ease: a.ease in EASES ? a.ease : 'ease-out',
    frames,
  };
}
/** A deck's animations, cleaned; at most 200. */
export function cleanAnims(anims) {
  const out = {};
  if (!anims || typeof anims !== 'object') return out;
  for (const [id, a] of Object.entries(anims).slice(0, 200)) { const c = okId(id) && cleanAnim(a); if (c) out[id] = c; }
  return out;
}

// One frame as CSS. Only numbers from cleanAnim are written.
function frameCss(f) {
  const v = k => f[k] ?? PROPS[k][3];
  const parts = [`translate: ${v('x')}px ${v('y')}px`, `scale: ${v('scale')}`, `rotate: ${v('rotate')}deg`, `opacity: ${v('opacity')}`];
  parts.push(`filter: ${v('blur') ? `blur(${v('blur')}px)` : 'none'}`);
  return `${f.at}% { ${parts.join('; ')}; }`;
}
export const keyframeName = id => `wpc-${id}`;
/** @keyframes for the given animations (id -> anim, already clean). */
export function keyframesCss(anims) {
  return Object.entries(anims).filter(([id]) => okId(id)).map(([id, a]) => `@keyframes ${keyframeName(id)} { ${a.frames.map(frameCss).join(' ')} }`).join('\n');
}
export const easeCss = a => (EASES[a?.ease] || EASES['ease-out'])[1];

// Starting points for a new animation (copies of the built-in effects, plus emphasis ones).
export const PRESETS = {
  fade: { name: 'Fade in', kind: 'in', dur: 0.6, ease: 'ease-out', frames: [{ at: 0, opacity: 0 }, { at: 100 }] },
  rise: { name: 'Rise', kind: 'in', dur: 0.7, ease: 'ease-out', frames: [{ at: 0, opacity: 0, y: 60 }, { at: 100 }] },
  'fly-left': { name: 'Fly in from left', kind: 'in', dur: 0.8, ease: 'snap', frames: [{ at: 0, x: -1800 }, { at: 100 }] },
  swoop: { name: 'Swoop', kind: 'in', dur: 1, ease: 'snap', frames: [{ at: 0, x: -600, y: 300, rotate: -25, scale: 0.4, opacity: 0 }, { at: 70, rotate: 4, scale: 1.04, opacity: 1 }, { at: 100 }] },
  pop: { name: 'Pop', kind: 'in', dur: 0.5, ease: 'spring', frames: [{ at: 0, scale: 0, opacity: 0 }, { at: 100 }] },
  unblur: { name: 'Focus', kind: 'in', dur: 0.8, ease: 'ease-out', frames: [{ at: 0, blur: 24, scale: 1.08, opacity: 0 }, { at: 100 }] },
  pulse: { name: 'Pulse', kind: 'emphasis', dur: 0.6, ease: 'ease-in-out', frames: [{ at: 0 }, { at: 50, scale: 1.15 }, { at: 100 }] },
  shake: { name: 'Shake', kind: 'emphasis', dur: 0.6, ease: 'linear', frames: [{ at: 0 }, { at: 20, x: -24 }, { at: 40, x: 24 }, { at: 60, x: -16 }, { at: 80, x: 16 }, { at: 100 }] },
  wiggle: { name: 'Wiggle', kind: 'emphasis', dur: 0.6, ease: 'ease-in-out', frames: [{ at: 0 }, { at: 25, rotate: -6 }, { at: 75, rotate: 6 }, { at: 100 }] },
  dim: { name: 'Dim', kind: 'emphasis', dur: 0.5, ease: 'ease-out', frames: [{ at: 0 }, { at: 100, opacity: 0.3 }] },
  'fade-out': { name: 'Fade out', kind: 'out', dur: 0.5, ease: 'ease-in', frames: [{ at: 0 }, { at: 100, opacity: 0 }] },
  fall: { name: 'Fall away', kind: 'out', dur: 0.8, ease: 'ease-in', frames: [{ at: 0 }, { at: 100, y: 900, rotate: 25, opacity: 0 }] },
  'zoom-away': { name: 'Zoom away', kind: 'out', dur: 0.6, ease: 'ease-in', frames: [{ at: 0 }, { at: 30, scale: 1.1 }, { at: 100, scale: 0, opacity: 0 }] },
  'swoop-out': { name: 'Swoop out', kind: 'out', dur: 0.9, ease: 'ease-in', frames: [{ at: 0 }, { at: 30, x: -60, rotate: -6 }, { at: 100, x: 1800, y: -300, rotate: 20, scale: 0.5, opacity: 0 }] },
};
/** The preset a new animation of each kind starts from. */
export const FIRST_PRESET = { in: 'rise', out: 'fade-out', emphasis: 'pulse' };

/* ---------- Custom slide transitions ---------- */
//
// deck.transitions = { id: transition }   a slide uses one with slide.trans.fx = 'custom:<id>'
// transition = { name, dur, ease, out: [frame], in: [frame] }
//   out  what the slide that is leaving does (it is underneath)
//   in   what the slide that is arriving does (on top)
// frame = { at (0-100 %), x, y (slide units), scale, rotate, turn (degrees, in 3D), opacity, blur }
// Going backwards, sideways movement and turns are mirrored, so a push goes the right way.
// Played with the Web Animations API from clamped numbers: nothing reaches a stylesheet.

export const TPROPS = {
  x: ['Move across', -3200, 3200, 0, 'px'],
  y: ['Move down', -1800, 1800, 0, 'px'],
  scale: ['Size', 0, 10, 1, '×'],
  rotate: ['Turn', -3600, 3600, 0, '°'],
  turn: ['Turn in 3D', -360, 360, 0, '°'],
  opacity: ['Opacity', 0, 1, 1, ''],
  blur: ['Blur', 0, 200, 0, 'px'],
};
function cleanFrames(list, props) {
  const frames = [];
  for (const f of (Array.isArray(list) ? list : []).slice(0, MAX_FRAMES)) {
    if (!f || typeof f !== 'object') continue;
    const at = num(f.at, 0, 100);
    if (at === undefined) continue;
    const frame = { at: Math.round(at * 10) / 10 };
    for (const [k, [, min, max]] of Object.entries(props)) { const v = num(f[k], min, max); if (v !== undefined) frame[k] = Math.round(v * 1000) / 1000; }
    frames.push(frame);
  }
  return frames.sort((p, q) => p.at - q.at);
}
/** A safe copy of a transition, or null. Each side has two or more frames, or none (it stays still). */
export function cleanTransition(t) {
  if (!t || typeof t !== 'object') return null;
  const out = cleanFrames(t.out, TPROPS), inn = cleanFrames(t.in, TPROPS);
  if (out.length === 1 || inn.length === 1 || (!out.length && !inn.length)) return null;
  return {
    name: String(t.name || 'Custom transition').replace(/[\u0000-\u001f]/g, '').slice(0, 60) || 'Custom transition',
    dur: num(t.dur, 0.1, 30) ?? 0.8,
    ease: t.ease in EASES ? t.ease : 'ease-in-out',
    out, in: inn,
  };
}
export function cleanTransitions(all) {
  const out = {};
  if (!all || typeof all !== 'object') return out;
  for (const [id, t] of Object.entries(all).slice(0, 100)) { const c = okId(id) && cleanTransition(t); if (c) out[id] = c; }
  return out;
}
export const transitionOf = (deck, fx) => (isCustom(fx) && deck?.transitions?.[customId(fx)]) || null;
/** Web Animations keyframes for one side, mirrored when `dir` is -1. */
export function transitionKeyframes(frames, dir = 1) {
  const v = (f, k) => f[k] ?? TPROPS[k][3];
  return frames.map(f => ({
    offset: f.at / 100,
    translate: `${v(f, 'x') * dir}px ${v(f, 'y')}px`,
    scale: `${v(f, 'scale')}`,
    rotate: `${v(f, 'rotate') * dir}deg`,
    transform: `perspective(2400px) rotateY(${v(f, 'turn') * dir}deg)`,
    opacity: v(f, 'opacity'),
    filter: `blur(${v(f, 'blur')}px)`,
  }));
}
export const TRANSITION_PRESETS = {
  'slide-up': { name: 'Slide up', dur: 0.7, ease: 'snap', out: [{ at: 0 }, { at: 100, y: -300, opacity: 0 }], in: [{ at: 0, y: 900 }, { at: 100 }] },
  'push-down': { name: 'Push down', dur: 0.7, ease: 'snap', out: [{ at: 0 }, { at: 100, y: 900 }], in: [{ at: 0, y: -900 }, { at: 100 }] },
  swing: { name: 'Swing in', dur: 0.9, ease: 'spring', out: [{ at: 0 }, { at: 100, opacity: 0, scale: 0.9 }], in: [{ at: 0, turn: -70, opacity: 0, x: 200 }, { at: 100 }] },
  spiral: { name: 'Spiral', dur: 1, ease: 'ease-in-out', out: [{ at: 0 }, { at: 100, rotate: 180, scale: 0, opacity: 0 }], in: [{ at: 0, rotate: -180, scale: 0, opacity: 0 }, { at: 100 }] },
  dissolve: { name: 'Dissolve', dur: 0.8, ease: 'ease-in-out', out: [{ at: 0 }, { at: 100, blur: 30, opacity: 0 }], in: [{ at: 0, blur: 30, opacity: 0 }, { at: 100 }] },
  'zoom-through': { name: 'Zoom through', dur: 0.8, ease: 'ease-in', out: [{ at: 0 }, { at: 100, scale: 3, opacity: 0 }], in: [{ at: 0, scale: 0.4, opacity: 0 }, { at: 100 }] },
};

/* ---------- My animations and My transitions (this computer) ---------- */

function makeLibrary(key, clean, what) {
  const subs = new Set();
  const read = () => { try { return clean(JSON.parse(localStorage.getItem(key) || '{}')); } catch { return {}; } };
  const write = lib => {
    try { localStorage.setItem(key, JSON.stringify(lib)); } catch { throw new Error(`This browser would not save the ${what} (storage is full or turned off).`); }
    subs.forEach(fn => fn());
  };
  return {
    read, onChange: fn => { subs.add(fn); return () => subs.delete(fn); },
    save(id, item) { const c = clean({ [id]: item })[id]; if (!c) throw new Error(`That ${what} is not valid.`); write({ ...read(), [id]: c }); },
    remove(id) { const lib = read(); delete lib[id]; write(lib); },
    add(found) { if (Object.keys(found).length) write({ ...read(), ...found }); },
  };
}
const animLibrary = makeLibrary('waypoint.anims', cleanAnims, 'animation');
export const transitionLibrary = makeLibrary('waypoint.transitions', cleanTransitions, 'transition');
export const onLibrary = animLibrary.onChange;
/** id -> anim. */
export const library = animLibrary.read;
export const saveToLibrary = animLibrary.save;
export const removeFromLibrary = animLibrary.remove;

/** My animations and My transitions as one file to share. */
export const libraryFile = (anims = library(), transitions = transitionLibrary.read()) =>
  JSON.stringify({ waypoint: 'animations', v: 2, anims, transitions }, null, 1);
/** Adds the animations and transitions in a shared file to the libraries; returns how many. */
export function importLibrary(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not an animations file.'); }
  const found = cleanAnims(data?.waypoint ? data.anims : data), trans = cleanTransitions(data?.transitions);
  const n = Object.keys(found).length + Object.keys(trans).length;
  if (!n) throw new Error('No animations or transitions found in that file.');
  animLibrary.add(found); transitionLibrary.add(trans);
  return n;
}
