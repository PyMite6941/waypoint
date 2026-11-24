// What an object does while presenting: its entrance (el.anim) and everything after it
// (el.acts): emphasis, exit, moving somewhere else, coming back in. No DOM, no React.
//
// el.anim = { fx, step, dur, delay, on }             the entrance (as before)
// el.acts = [{ kind, fx, step, dur, delay, on, to }]  later actions, in order
//   kind  'in' | 'out' | 'emphasis' | 'move'
//   fx    a built-in effect (IN, OUT, EMPHASIS below) or 'custom:<id>' (see anims.js);
//         for 'move', the easing (a key of EASES)
//   step  0 plays with the slide, n on the slide's nth click ... or, with `on`,
//   on    the id of an object on the same slide: the action plays on that object's nth click
//         (a trigger). Clicking a trigger after its last action starts its sequence again,
//         so two actions on one trigger make a toggle (show / hide).
//   to    for 'move': { x, y, w, h, rot } where the object ends up
//
// Each action plays once, when its click comes; what it leaves behind (hidden after an exit,
// in its new place after a move) stays until the slide is left or a trigger starts over.
import { EASES, animOf, isCustom } from './anims.js';

export const KIND_NAMES = { in: 'Entrance', emphasis: 'Emphasis', out: 'Exit', move: 'Move' };
export const IN = {
  appear: 'Appear', fade: 'Fade in', rise: 'Rise', 'fly-left': 'Fly in from left', 'fly-right': 'Fly in from right',
  'fly-up': 'Fly in from bottom', drop: 'Drop in', zoom: 'Zoom', pop: 'Pop', wipe: 'Wipe', blur: 'Focus', spin: 'Spin',
};
export const OUT = {
  'out-fade': 'Fade out', 'out-vanish': 'Disappear', 'out-sink': 'Sink', 'out-left': 'Fly out to left', 'out-right': 'Fly out to right',
  'out-down': 'Fly out down', 'out-up': 'Fly out up', 'out-zoom': 'Shrink away', 'out-blur': 'Blur away', 'out-spin': 'Spin away', 'out-wipe': 'Wipe away',
};
export const EMPHASIS = {
  'em-pulse': 'Pulse', 'em-shake': 'Shake', 'em-wiggle': 'Wiggle', 'em-bounce': 'Bounce', 'em-spin': 'Spin', 'em-flash': 'Flash', 'em-jelly': 'Jelly', 'em-glow': 'Grow and back',
};
export const BUILT_IN = { in: IN, out: OUT, emphasis: EMPHASIS };
export const DEFAULT_FX = { in: 'fade', out: 'out-fade', emphasis: 'em-pulse', move: 'ease-in-out' };

/** Every action of an object, entrance first. The entrance of a custom emphasis animation
 *  (older decks) counts as an emphasis: the object is showing from the start. */
export function actsOf(deck, el) {
  const out = [];
  if (el.anim?.fx) out.push({ ...el.anim, kind: animOf(deck, el.anim.fx)?.kind === 'emphasis' ? 'emphasis' : 'in', entrance: true });
  if (Array.isArray(el.acts)) for (const a of el.acts) if (a && a.kind in KIND_NAMES) out.push(a);
  return out;
}

const startsOf = a => ({ on: a.on || null, step: a.step || 0 });
/** Has this action's moment come? `build`: the slide's click count; `taps`: { id: clicks } of triggers. */
export const reached = (a, build, taps) => (a.on ? (taps?.[a.on] || 0) >= (a.step || 1) : build >= (a.step || 0));
/** Does action `a` start at event `ev` ({ on, step })? */
export const startsAt = (a, ev) => !!ev && (a.on || null) === (ev.on || null) && (a.step || 0) === ev.step;

/** How many clicks of the slide play actions before Next moves on. */
export function slideSteps(slide) {
  let n = 0;
  for (const e of slide.els) {
    if (e.anim?.fx && !e.anim.on) n = Math.max(n, e.anim.step || 0);
    if (Array.isArray(e.acts)) for (const a of e.acts) if (a && !a.on) n = Math.max(n, a.step || 0);
  }
  return n;
}
/** How many clicks of object `id` do something (0: it is not a trigger). */
export function triggerSteps(slide, id) {
  let n = 0;
  for (const e of slide.els) {
    if (e.anim?.fx && e.anim.on === id) n = Math.max(n, e.anim.step || 1);
    if (Array.isArray(e.acts)) for (const a of e.acts) if (a?.on === id) n = Math.max(n, a.step || 1);
  }
  return n;
}
/** Ids of the objects on a slide that are triggers. */
export function triggersOf(slide) {
  const ids = new Set(slide.els.map(e => e.id)), out = new Set();
  for (const e of slide.els) {
    if (e.anim?.fx && ids.has(e.anim.on)) out.add(e.anim.on);
    if (Array.isArray(e.acts)) for (const a of e.acts) if (ids.has(a?.on)) out.add(a.on);
  }
  return out;
}

const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
export const geomOf = el => ({ x: el.x, y: el.y, w: el.w, h: el.h, rot: el.rot || 0 });

/**
 * Where an object is and whether it shows, once every action that has come has played.
 * `skip` leaves out the actions starting at that event (the state just before it).
 */
export function stateOf(deck, el, build, taps, skip = null) {
  const acts = actsOf(deck, el);
  let visible = !(acts[0]?.entrance && acts[0].kind === 'in'), g = geomOf(el);
  for (const a of acts) {
    if (!reached(a, build, taps) || (skip && startsAt(a, skip))) continue;
    if (a.kind === 'in') visible = true;
    else if (a.kind === 'out') visible = false;
    else if (a.kind === 'move' && a.to) g = { x: num(a.to.x, g.x), y: num(a.to.y, g.y), w: Math.max(1, num(a.to.w, g.w)), h: Math.max(1, num(a.to.h, g.h)), rot: num(a.to.rot, g.rot) };
  }
  return { visible, g };
}

/** The next free click of the slide for a new action, not counting `except`. */
export function nextSlideStep(slide, except) {
  const els = slide.els.map(e => (e === except.el ? { ...e, ...(except.entrance ? { anim: undefined } : { acts: (e.acts || []).filter((_, i) => i !== except.index) }) } : e));
  return slideSteps({ els }) + 1;
}

/** A clean copy of an object's actions (from files and the internet). */
export function cleanActs(acts) {
  if (!Array.isArray(acts)) return undefined;
  const out = [];
  for (const a of acts.slice(0, 40)) {
    if (!a || !(a.kind in KIND_NAMES)) continue;
    const fx = a.kind === 'move' ? (a.fx in EASES ? a.fx : DEFAULT_FX.move)
      : (a.fx in BUILT_IN[a.kind] || (isCustom(a.fx) && /^custom:[a-z0-9]{1,24}$/i.test(a.fx)) ? a.fx : DEFAULT_FX[a.kind]);
    const c = { kind: a.kind, fx, step: Math.max(0, Math.min(999, Math.round(num(a.step, 0)))), dur: Math.max(0.05, Math.min(30, num(a.dur, 0.6))) };
    if (num(a.delay, 0) > 0) c.delay = Math.min(60, num(a.delay, 0));
    if (typeof a.on === 'string' && a.on) { c.on = a.on.slice(0, 40); c.step = Math.max(1, c.step); }
    if (a.kind === 'move') {
      const t = a.to || {};
      c.to = { x: num(t.x, 0), y: num(t.y, 0), w: Math.max(1, num(t.w, 100)), h: Math.max(1, num(t.h, 100)), rot: Math.max(-3600, Math.min(3600, num(t.rot, 0))) };
      for (const k of ['x', 'y', 'w', 'h']) c.to[k] = Math.max(-10000, Math.min(10000, Math.round(c.to[k])));
    }
    out.push(c);
  }
  return out.length ? out : undefined;
}

/** New ids for the objects of copied slides, with triggers following them. `idOf(old)` gives the new id. */
export function retarget(els, idOf) {
  for (const e of els) {
    if (e.anim?.on) e.anim.on = idOf(e.anim.on) || undefined;
    if (Array.isArray(e.acts)) for (const a of e.acts) if (a.on) a.on = idOf(a.on) || undefined;
  }
}
/** A copy of a slide's objects with new ids (triggers kept working). `uid` makes an id. */
export function copyEls(els, uid) {
  const ids = new Map(), out = structuredClone(els);
  for (const e of out) { const id = uid(); ids.set(e.id, id); e.id = id; }
  retarget(out, id => ids.get(id));
  return out;
}

/** Longest time (seconds) the actions starting at `ev` take. */
export function longestAt(deck, slide, ev) {
  let t = 0.5;
  for (const e of slide.els) for (const a of actsOf(deck, e)) if (startsAt(a, ev)) t = Math.max(t, (a.dur || animOf(deck, a.fx)?.dur || 0.5) + (a.delay || 0));
  return t;
}
