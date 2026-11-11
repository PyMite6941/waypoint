import { useEffect, useRef, useState } from 'react';
import { choicesOf, clampIndex, indexOfId, slideTitle } from '../lib/deck.js';
import { listen, send } from '../lib/store.js';
import SlideView, { Fit, Thumb } from './SlideView.jsx';

export const NEXT_KEYS = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'];
export const PREV_KEYS = ['ArrowLeft', 'ArrowUp', 'PageUp', 'p'];

// What the audience sees. Owns the current position and the trail of slides visited,
// so Backspace can return to wherever the presenter jumped from.
export default function Show({ deck, start, fullscreen, onExit }) {
  const [s, setS] = useState({ i: clampIndex(deck, start), trail: [], num: '', grid: false, pick: 0, black: false });
  const [awake, setAwake] = useState(false);
  const box = useRef(null), sleep = useRef(0), stay = useRef(false), at = useRef(s.i);
  at.current = s.i;
  const slide = deck.slides[s.i];

  const moveTo = target => setS(p => {
    const i = clampIndex(deck, typeof target === 'function' ? target(p.i) : target);
    return { ...p, i, trail: i === p.i ? p.trail : [...p.trail, p.i], grid: false, num: '' };
  });
  const step = d => moveTo(i => i + d);
  const back = () => setS(p => (p.trail.length
    ? { ...p, i: clampIndex(deck, p.trail.at(-1)), trail: p.trail.slice(0, -1), grid: false, num: '' }
    : { ...p, grid: false, num: '' }));
  const toggleGrid = () => setS(p => ({ ...p, grid: !p.grid, pick: p.i, num: '' }));

  function toggleFullscreen() {
    if (document.fullscreenElement) { stay.current = true; document.exitFullscreen(); }
    else box.current.requestFullscreen?.().catch(() => {});
  }

  // Esc in fullscreen is swallowed by the browser, so leaving fullscreen ends the show,
  // unless the presenter asked for a windowed show with F.
  useEffect(() => {
    if (fullscreen) box.current.requestFullscreen?.().catch(() => {});
    const onChange = () => {
      if (document.fullscreenElement) return;
      if (stay.current) stay.current = false; else onExit(at.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) document.exitFullscreen();
    };
  }, []);

  // Keep the presenter window in step, and take its requests.
  useEffect(() => { send({ type: 'state', i: s.i }); }, [s.i]);
  useEffect(() => listen(m => {
    if (m.type === 'hello') send({ type: 'state', i: at.current });
    else if (m.type === 'goto') moveTo(m.i);
    else if (m.type === 'step') step(m.d);
    else if (m.type === 'back') back();
  }), []);

  useEffect(() => {
    const onKey = e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      let hit = true;
      if (s.grid) {
        const cols = getComputedStyle(box.current.querySelector('.grid-view')).gridTemplateColumns.split(' ').length;
        const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[k];
        if (d) setS(p => ({ ...p, pick: clampIndex(deck, p.pick + d) }));
        else if (k === 'Enter' || k === ' ') moveTo(s.pick);
        else if (k === 'Escape' || k === 'g' || k === 'Tab') toggleGrid();
        else hit = false;
      } else if (/^\d$/.test(k)) setS(p => ({ ...p, num: p.num + k }));
      else if (s.num && k === 'Enter') moveTo(+s.num - 1);
      else if (s.num && k === 'Escape') setS(p => ({ ...p, num: '' }));
      else if (NEXT_KEYS.includes(k)) step(1);
      else if (PREV_KEYS.includes(k)) step(-1);
      else if (k === 'Backspace') back();
      else if (k === 'Home') moveTo(0);
      else if (k === 'End') moveTo(deck.slides.length - 1);
      else if (k === 'g' || k === 'Tab') toggleGrid();
      else if (k === 'b' || k === '.') setS(p => ({ ...p, black: !p.black, num: '' }));
      else if (k === 'f') toggleFullscreen();
      else if (k === 'Escape') onExit(s.i);
      else hit = k === 'F5';   // some clickers send F5; never reload mid-talk
      if (hit) { e.preventDefault(); e.stopPropagation(); }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [s, deck]);

  function onClick(e) {
    if (e.target.closest('.hud')) return;
    if (s.black) return setS(p => ({ ...p, black: false }));
    if (s.grid) {
      const picked = e.target.closest('[data-i]');
      if (picked) moveTo(+picked.dataset.i);
      return;
    }
    const j = indexOfId(deck, e.target.closest('[data-link]')?.dataset.link);
    if (j >= 0) moveTo(j); else step(1);
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
        <Fit className="screen"><SlideView deck={deck} slide={slide} /></Fit>
      )}
      <div className="hud">
        <button tabIndex={-1} onClick={() => step(-1)}>‹</button>
        <span>{s.i + 1} / {deck.slides.length}</span>
        <button tabIndex={-1} onClick={() => step(1)}>›</button>
        {choicesOf(deck, slide).map(j => (
          <button key={j} tabIndex={-1} className="choice" onClick={() => moveTo(j)}>{j + 1} · {slideTitle(deck.slides[j])}</button>
        ))}
        <button tabIndex={-1} onClick={toggleGrid}>Slides</button>
        <button tabIndex={-1} onClick={() => onExit(s.i)}>Exit</button>
      </div>
      {s.num && <div className="num">Go to {s.num}</div>}
    </div>
  );
}
