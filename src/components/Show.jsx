import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { buildSteps, choicesOf, clampIndex, indexOfId, slideTitle } from '../lib/deck.js';
import { listen, send } from '../lib/store.js';
import { playTransition } from '../lib/transitions.js';
import { actionOf, clickerSettings, justFocused } from '../lib/clicker.js';
import SlideView, { Fit, Thumb } from './SlideView.jsx';

// What the audience sees. Owns the current position (slide `i`, build step `b`) and the
// trail of slides visited, so Backspace can return to wherever the presenter jumped from.
// Next plays the slide's builds one click at a time before moving on; Previous steps back
// through them without animation, like Keynote.
// With `audience` it is the slides window opened by Present: leaving full screen keeps
// the show going, since that window sits on a projector the presenter may not be facing.
// `enter` plays the first slide's transition in from the slide before it (used by Preview in the editor).
export default function Show({ deck, start, fullscreen, audience, enter, onMove, onExit }) {
  // play: the build step whose effects run now (null: show it still). n counts slide changes; last is where we came from.
  const [s, setS] = useState(() => {
    const i = clampIndex(deck, start);
    const last = enter && i > 0 ? { i: i - 1, b: buildSteps(deck.slides[i - 1]), dir: 1 } : null;
    return { i, b: 0, play: 0, n: last ? 1 : 0, last, trail: [], num: '', grid: false, pick: 0, black: false };
  });
  const [awake, setAwake] = useState(false);
  const [full, setFull] = useState(!!document.fullscreenElement);
  const [leaving, setLeaving] = useState(null);   // { i, b, dir, n }: the slide transitioning out
  const box = useRef(null), sleep = useRef(0), stay = useRef(false), at = useRef(s.i), layers = useRef({});
  at.current = s.i;
  const slide = deck.slides[s.i];

  // Go to slide `target`. `full` shows all its builds at once (going backwards).
  const moveTo = (target, full = false) => setS(p => {
    const i = clampIndex(deck, typeof target === 'function' ? target(p.i) : target);
    if (i === p.i) return { ...p, grid: false, num: '' };
    return { ...p, i, b: full ? buildSteps(deck.slides[i]) : 0, play: full ? null : 0, n: p.n + 1, last: { i: p.i, b: p.b, dir: i > p.i ? 1 : -1 }, trail: [...p.trail, p.i], grid: false, num: '' };
  });
  const next = () => setS(p => {
    if (p.b < buildSteps(deck.slides[p.i])) return { ...p, b: p.b + 1, play: p.b + 1, num: '' };
    const i = clampIndex(deck, p.i + 1);
    return i === p.i ? p : { ...p, i, b: 0, play: 0, n: p.n + 1, last: { i: p.i, b: p.b, dir: 1 }, trail: [...p.trail, p.i], num: '' };
  });
  const prev = () => setS(p => {
    if (p.b > 0) return { ...p, b: p.b - 1, play: null, num: '' };
    const i = clampIndex(deck, p.i - 1);
    return i === p.i ? p : { ...p, i, b: buildSteps(deck.slides[i]), play: null, n: p.n + 1, last: { i: p.i, b: p.b, dir: -1 }, trail: [...p.trail, p.i], num: '' };
  });
  const step = d => (d > 0 ? next() : prev());
  const back = () => setS(p => {
    if (!p.trail.length) return { ...p, grid: false, num: '' };
    const i = clampIndex(deck, p.trail.at(-1));
    return { ...p, i, b: buildSteps(deck.slides[i]), play: null, n: p.n + 1, last: { i: p.i, b: p.b, dir: -1 }, trail: p.trail.slice(0, -1), grid: false, num: '' };
  });
  const toggleBlack = () => setS(p => ({ ...p, black: !p.black, num: '' }));
  const toggleGrid = () => setS(p => ({ ...p, grid: !p.grid, pick: p.i, num: '' }));

  // Play the arriving slide's transition over the one leaving.
  useLayoutEffect(() => {
    if (!s.last || s.grid) return;
    const fx = deck.slides[s.i].trans?.fx;
    if (!fx || fx === 'none' || !deck.slides[s.last.i]) return setLeaving(null);
    setLeaving({ ...s.last, n: s.n });
  }, [s.n]);
  useLayoutEffect(() => {
    if (!leaving || leaving.n !== s.n) return;
    const to = deck.slides[s.i], a = deck.slides[leaving.i];
    let done = false;
    playTransition({ fx: to.trans.fx, dur: to.trans.dur, dir: leaving.dir, from: layers.current.out, to: layers.current.in, a, b: to })
      .then(() => { if (!done) setLeaving(l => (l?.n === leaving.n ? null : l)); });
    return () => { done = true; };
  }, [leaving]);
  function toggleFullscreen() {
    if (document.fullscreenElement) { stay.current = true; document.exitFullscreen(); }
    else box.current.requestFullscreen?.().catch(() => {});
  }

  // Esc in fullscreen is swallowed by the browser, so leaving fullscreen ends the show,
  // unless the presenter asked for a windowed show with F.
  useEffect(() => {
    if (fullscreen) box.current.requestFullscreen?.().catch(() => {});
    const onChange = () => {
      setFull(!!document.fullscreenElement);
      if (document.fullscreenElement) return;
      if (stay.current || audience) stay.current = false; else onExit(at.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) document.exitFullscreen();
    };
  }, []);

  // Keep the presenter window in step, and take its requests.
  const pos = useRef({ i: s.i, b: s.b });
  pos.current = { i: s.i, b: s.b };
  useEffect(() => { send({ type: 'state', i: s.i, b: s.b }); onMove?.(s.i); }, [s.i, s.b]);
  // Messages and background clicker keys arrive outside React; always use this render's deck.
  const live = useRef();
  live.current = { moveTo, step, back, toggleBlack };
  useEffect(() => listen(m => {
    const a = live.current;
    if (m.type === 'hello') send({ type: 'state', ...pos.current });
    else if (m.type === 'goto') a.moveTo(m.i);
    else if (m.type === 'step') a.step(m.d);
    else if (m.type === 'back') a.back();
    else if (m.type === 'black') a.toggleBlack();
  }), []);

  // Desktop app: the clicker's Page Up / Down reach the show even while another app is in front.
  useEffect(() => {
    if (!audience || !window.desktop?.onClicker) return;
    return window.desktop.onClicker(act => {
      if (act === 'black') live.current.toggleBlack();
      else if (act === 'next' || act === 'prev') live.current.step(act === 'next' ? 1 : -1);
    });
  }, []);

  const keys = useRef(clickerSettings());
  useEffect(() => {
    const onKey = e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, act = actionOf(e, keys.current);
      let hit = true;
      if (s.grid) {
        const cols = getComputedStyle(box.current.querySelector('.grid-view')).gridTemplateColumns.split(' ').length;
        const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[k];
        if (d) setS(p => ({ ...p, pick: clampIndex(deck, p.pick + d) }));
        else if (k === 'Enter' || k === ' ') moveTo(s.pick);
        else if (k === 'Escape' || k === 'g' || k === 'Tab') toggleGrid();
        else if (act === 'next' || act === 'prev') setS(p => ({ ...p, pick: clampIndex(deck, p.pick + (act === 'next' ? 1 : -1)) }));
        else hit = act === 'ignore';
      } else if (/^\d$/.test(k)) setS(p => ({ ...p, num: p.num + k }));
      else if (s.num && k === 'Enter') moveTo(+s.num - 1);
      else if (s.num && k === 'Escape') setS(p => ({ ...p, num: '' }));
      else if (act === 'next') next();
      else if (act === 'prev') prev();
      else if (act === 'black') toggleBlack();
      else if (k === 'Backspace') back();
      else if (k === 'Home') moveTo(0);
      else if (k === 'End') moveTo(deck.slides.length - 1);
      else if (k === 'g' || k === 'Tab') toggleGrid();
      else if (k === 'f') toggleFullscreen();
      else if (k === 'Escape') onExit(s.i);
      else hit = act === 'ignore';
      if (hit) { e.preventDefault(); e.stopPropagation(); }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [s, deck]);

  function onClick(e) {
    if (e.target.closest('.hud') || justFocused()) return;   // that click only brought the window to the front
    if (s.black) return setS(p => ({ ...p, black: false }));
    if (s.grid) {
      const picked = e.target.closest('[data-i]');
      if (picked) moveTo(+picked.dataset.i);
      return;
    }
    const j = indexOfId(deck, e.target.closest('[data-link]')?.dataset.link);
    if (j >= 0) moveTo(j); else next();
  }

  function wake() {
    setAwake(true);
    clearTimeout(sleep.current);
    sleep.current = setTimeout(() => setAwake(false), 2000);
  }
  useEffect(() => () => clearTimeout(sleep.current), []);

  const classes = [awake && 'awake', s.grid && 'grid', s.black && 'black'].filter(Boolean).join(' ');
  return (
    // preventDefault on mousedown keeps focus off the buttons, so Space never double-fires.
    <div id="show" ref={box} className={classes} onClick={onClick} onMouseMove={wake} onMouseDown={e => e.preventDefault()}>
      {s.grid ? (
        <div className="screen grid-view">
          {deck.slides.map((sl, j) => (
            <button key={sl.id} data-i={j} className={j === s.pick ? 'on' : undefined} ref={j === s.pick ? n => n?.scrollIntoView({ block: 'nearest' }) : undefined}>
              <Thumb deck={deck} slide={sl} width={240} />
              <span>{j + 1}&nbsp; {slideTitle(sl)}</span>
            </button>
          ))}
        </div>
      ) : (
        <Fit className="screen">
          <div className="stack">
            {leaving && deck.slides[leaving.i] && (
              <div className="layer" key={`out${leaving.n}`} ref={n => { layers.current.out = n; }}>
                <SlideView deck={deck} slide={deck.slides[leaving.i]} build={leaving.b} />
              </div>
            )}
            <div className="layer" key={`in${s.n}`} ref={n => { layers.current.in = n; }}>
              <SlideView deck={deck} slide={slide} build={s.b} fx={s.play} fxDelay={s.play === 0 && slide.trans?.fx && s.last ? slide.trans.dur || 0.6 : 0} />
            </div>
          </div>
        </Fit>
      )}
      <div className="hud">
        <button tabIndex={-1} onClick={prev}>‹</button>
        <span>{s.i + 1} / {deck.slides.length}</span>
        <button tabIndex={-1} onClick={next}>›</button>
        {choicesOf(deck, slide).map(j => (
          <button key={j} tabIndex={-1} className="choice" onClick={() => moveTo(j)}>{j + 1} · {slideTitle(deck.slides[j])}</button>
        ))}
        <button tabIndex={-1} onClick={toggleGrid}>Slides</button>
        {audience && <button tabIndex={-1} onClick={toggleFullscreen}>{full ? 'Window' : 'Full screen'}</button>}
        <button tabIndex={-1} onClick={() => onExit(s.i)}>Exit</button>
      </div>
      {s.num && <div className="num">Go to {s.num}</div>}
      {audience && !full && !window.desktop && (
        <button className="hud gofull" tabIndex={-1} onClick={toggleFullscreen}>Full screen (F)</button>
      )}
    </div>
  );
}
