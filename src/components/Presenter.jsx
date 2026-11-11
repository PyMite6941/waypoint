import { useEffect, useState } from 'react';
import { choicesOf, clampIndex, slideTitle } from '../lib/deck.js';
import { listen, loadDeck, send } from '../lib/store.js';
import { NEXT_KEYS, PREV_KEYS } from './Show.jsx';
import SlideView, { Fit, Thumb } from './SlideView.jsx';

const two = n => String(n).padStart(2, '0');

// The presenter's own window: current and next slide, notes, timer and a picker
// for every slide. It never moves the show itself; it asks, and mirrors the answer.
export default function Presenter({ initial }) {
  const [deck, setDeck] = useState(initial);
  const [at, setAt] = useState(0);
  const [num, setNum] = useState('');
  const [started, setStarted] = useState(Date.now);
  const [now, setNow] = useState(Date.now);

  const i = clampIndex(deck, at), slide = deck.slides[i], after = deck.slides[i + 1];

  useEffect(() => {
    document.title = 'Presenter · Waypoint';
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const stop = listen(async m => {
      if (m.type === 'state') setAt(m.i);
      else if (m.type === 'deck') { const fresh = await loadDeck(); if (fresh) setDeck(fresh); }
    });
    send({ type: 'hello' });
    return () => { clearInterval(tick); stop(); };
  }, []);

  useEffect(() => {
    const onKey = e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (/^\d$/.test(k)) setNum(n => n + k);
      else if (k === 'Enter' && num) { send({ type: 'goto', i: +num - 1 }); setNum(''); }
      else if (k === 'Escape' && num) setNum('');
      else if (NEXT_KEYS.includes(k)) send({ type: 'step', d: 1 });
      else if (PREV_KEYS.includes(k)) send({ type: 'step', d: -1 });
      else if (k === 'Backspace') send({ type: 'back' });
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [num]);

  const elapsed = Math.max(0, Math.floor((now - started) / 1000)), clock = new Date(now);
  const goto = j => send({ type: 'goto', i: j });

  return (
    <div id="pv" onMouseDown={e => e.preventDefault()}>
      <Fit className="pvNow"><SlideView deck={deck} slide={slide} /></Fit>
      <div className="pvSide">
        <h2>Next</h2>
        {after ? <Fit className="pvNext"><SlideView deck={deck} slide={after} /></Fit> : <div className="pvNext"><p>End of deck</p></div>}
        <div className="pvChoices">
          {choicesOf(deck, slide).map(j => <button key={j} onClick={() => goto(j)}>{j + 1} · {slideTitle(deck.slides[j])}</button>)}
        </div>
        <h2>Notes</h2>
        <div className="pvNotes">{slide.notes || 'No notes for this slide.'}</div>
      </div>
      <div className="pvStrip">
        {deck.slides.map((sl, j) => (
          <button key={sl.id} className={j === i ? 'on' : undefined} onClick={() => goto(j)} ref={j === i ? n => n?.scrollIntoView({ block: 'nearest', inline: 'center' }) : undefined}>
            <Thumb deck={deck} slide={sl} width={128} />
            <span>{j + 1}</span>
          </button>
        ))}
      </div>
      <div className="pvBar">
        <button title="Click to reset" onClick={() => setStarted(Date.now())}>{two(Math.floor(elapsed / 60))}:{two(elapsed % 60)}</button>
        <span>{i + 1} / {deck.slides.length}{num && ` · Go to ${num}`}</span>
        <span>{clock.getHours()}:{two(clock.getMinutes())}</span>
      </div>
    </div>
  );
}
