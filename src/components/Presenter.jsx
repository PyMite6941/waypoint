import { useEffect, useRef, useState } from 'react';
import { buildSteps, choicesOf, clampIndex, slideTitle } from '../lib/deck.js';
import { listen, send } from '../lib/store.js';
import { actionOf, clickerSettings, isClickerOnly, justFocused } from '../lib/clicker.js';
import LightTable, { COLUMNS, ColumnSwitch, saveCols, savedCols } from './LightTable.jsx';
import SlideView, { Fit } from './SlideView.jsx';
import { ClickerStatus } from './ClickerMenu.jsx';

const two = n => String(n).padStart(2, '0');

// The talk timer and the time of day tick on their own, so the slides are not redrawn every second.
function useNow(every = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const tick = setInterval(() => setNow(Date.now()), every); return () => clearInterval(tick); }, [every]);
  return now;
}
function Timer() {
  const [started, setStarted] = useState(Date.now);
  const elapsed = Math.max(0, Math.floor((useNow() - started) / 1000));
  return <button className="pvTimer" title="Click to reset" onClick={() => setStarted(Date.now())}>{two(Math.floor(elapsed / 60))}:{two(elapsed % 60)}</button>;
}
function Clock() {
  const clock = new Date(useNow(5000));
  return <span className="pvClock">{clock.getHours()}:{two(clock.getMinutes())}</span>;
}

// The presenter's controller, laid out like Keynote's presenter display: the current
// slide, what comes next and your notes on the left, and every slide in the deck on a
// light table on the right. Click any slide to send the audience there.
// It never moves the show itself; it asks the audience window, and mirrors the answer.
export default function Presenter({ deck, start = 0, where, onEnd }) {
  const [at, setAt] = useState(start);
  const [b, setB] = useState(0);   // build step the audience is on
  const [num, setNum] = useState('');
  const [cols, setColsState] = useState(savedCols);
  const setCols = n => { setColsState(n); saveCols(n); };
  const [visited, setVisited] = useState(() => new Set([start]));
  const end = useRef(onEnd);
  end.current = onEnd;

  const i = clampIndex(deck, at), slide = deck.slides[i], after = deck.slides[i + 1];
  const nextIndex = after ? i + 1 : -1, choices = choicesOf(deck, slide);
  const steps = buildSteps(slide), moreBuilds = b < steps;

  useEffect(() => {
    const stop = listen(m => {
      if (m.type === 'state') { setAt(m.i); setB(m.b || 0); setVisited(v => new Set(v).add(m.i)); }
      else if (m.type === 'ended') end.current(m.i, true);
    });
    send({ type: 'hello' });
    return stop;
  }, []);

  // The same keys as the slides window, so the clicker works whichever of the two has focus.
  // A text box keeps ordinary keys, but never the clicker's Page Up / Down.
  const keys = useRef(clickerSettings());
  useEffect(() => {
    const onKey = e => {
      const t = e.target, typing = t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox');
      if (e.ctrlKey || e.metaKey || e.altKey || (typing && !isClickerOnly(e))) return;
      if (t.tagName === 'INPUT' && !typing) t.blur();   // a slider would otherwise eat the arrow keys
      const k = e.key, act = actionOf(e, keys.current);
      if (/^\d$/.test(k)) setNum(n => n + k);
      else if (k === 'Enter' && num) { send({ type: 'goto', i: +num - 1 }); setNum(''); }
      else if (k === 'Escape' && num) setNum('');
      else if (k === 'Escape') end.current(i);
      else if (act === 'next') send({ type: 'step', d: 1 });
      else if (act === 'prev') send({ type: 'step', d: -1 });
      else if (act === 'black') send({ type: 'black' });
      else if (act === 'ignore') { /* the clicker's start button: swallow it */ }
      else if (k === 'Backspace') send({ type: 'back' });
      else if (k === 'Home') send({ type: 'goto', i: 0 });
      else if (k === 'End') send({ type: 'goto', i: deck.slides.length - 1 });
      else if (k === '+' || k === '=') setCols(COLUMNS[0]);   // bigger slides
      else if (k === '-') setCols(COLUMNS.at(-1));            // more slides per row
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [num, i, deck]);

  // The big click targets ignore the click that only brought this window to the front.
  const goto = j => { if (!justFocused()) send({ type: 'goto', i: j }); };
  const nextClick = () => { if (!justFocused()) send({ type: 'step', d: 1 }); };

  return (
    // Keep focus off buttons so Space never double-fires; the size slider still needs its mousedown.
    <div id="pv" onMouseDown={e => { if (e.target.closest('button')) e.preventDefault(); }}>
      <div className="pvBar">
        <Timer />
        <span className="pvPos">Slide {i + 1} of {deck.slides.length}{num && ` · Go to ${num}`}</span>
        <span className="pvWhere">{where === 'screen' ? 'Slides are on the other display' : where === 'window' ? 'Slides are in their own window' : ''}</span>
        <ClickerStatus />
        <span className="grow" />
        <button onClick={() => send({ type: 'step', d: -1 })} title="Previous (←)">‹ Prev</button>
        <button onClick={() => send({ type: 'back' })} title="Return to the slide you jumped from (Backspace)">↩ Back</button>
        <button className="primary" onClick={() => send({ type: 'step', d: 1 })} title="Next (→, Space, Page Down)">Next ›</button>
        <button onClick={() => send({ type: 'black' })} title="Black screen on and off (B or .)">Black</button>
        <Clock />
        <button className="pvEnd" onClick={() => end.current(i)} title="End the show (Esc)">End show</button>
      </div>

      <div className="pvLeft">
        <h2>Current · {i + 1}{steps > 0 && <span className="pvBuild"> · build {b} of {steps}</span>}</h2>
        <Fit className="pvNow"><SlideView deck={deck} slide={slide} build={b} /></Fit>
        <h2>{moreBuilds ? `Next · build ${b + 1} of ${steps}` : `Next${after ? ` · ${i + 2}` : ''}`}</h2>
        {moreBuilds
          ? <Fit className="pvNext" onClick={nextClick}><SlideView deck={deck} slide={slide} build={b + 1} /></Fit>
          : after
            ? <Fit className="pvNext" onClick={nextClick}><SlideView deck={deck} slide={after} build={0} /></Fit>
            : <div className="pvNext"><p>End of deck</p></div>}
        {choices.length > 0 && (
          <div className="pvChoices">
            {choices.map(j => <button key={j} onClick={() => goto(j)}>{j + 1} · {slideTitle(deck.slides[j])}</button>)}
          </div>
        )}
        <h2>Notes</h2>
        <div className="pvNotes">{slide.notes || 'No notes for this slide.'}</div>
      </div>

      <div className="pvAll">
        <div className="pvAllHead">
          <h2>All slides</h2>
          <span className="grow" />
          <span>Click a slide to show it</span>
          <ColumnSwitch cols={cols} setCols={setCols} />
        </div>
        <LightTable deck={deck} active={i} next={nextIndex} choices={choices} seen={visited} cols={cols} onPick={goto} />
      </div>
    </div>
  );
}
