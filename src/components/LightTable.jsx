import { slideTitle } from '../lib/deck.js';
import SlideView, { Fit } from './SlideView.jsx';

export const COLUMNS = [3, 4];

// Every slide as a thumbnail on a grid, like Keynote's light table. The active slide is
// ringed in orange. Used by present mode (to pick where to start) and by the controller
// during a show (to send the audience anywhere).
//   active  index ringed in orange       next / choices  indexes marked as upcoming
//   seen    Set of indexes already shown (dimmed)
//   onPick  click        onOpen  double-click
export default function LightTable({ deck, active, next = -1, choices = [], seen, cols, onPick, onOpen }) {
  return (
    <div className="lightTable" style={{ '--cols': cols }}>
      {deck.slides.map((sl, j) => {
        const cls = [j === active && 'now', j === next && 'next', choices.includes(j) && 'choice', j !== active && seen?.has(j) && 'seen'].filter(Boolean).join(' ');
        return (
          <button
            key={sl.id} className={cls || undefined} title={`${j + 1} · ${slideTitle(sl)}`}
            onClick={() => onPick(j)} onDoubleClick={onOpen && (() => onOpen(j))}
            ref={j === active ? n => n?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) : undefined}
          >
            <Fit className="ltSlide"><SlideView deck={deck} slide={sl} /></Fit>
            <span><b>{j + 1}</b> {slideTitle(sl)}</span>
            {j === active && <em>Now</em>}
            {j === next && <em>Next</em>}
          </button>
        );
      })}
    </div>
  );
}

// The 3 | 4 column switch shown above a light table.
export function ColumnSwitch({ cols, setCols }) {
  return (
    <span className="colSwitch" role="group" aria-label="Columns">
      Columns
      {COLUMNS.map(n => <button key={n} className={n === cols ? 'on' : undefined} aria-pressed={n === cols} onClick={() => setCols(n)}>{n}</button>)}
    </span>
  );
}

// Remembered per browser; falls back to 3 if storage is unavailable.
export function savedCols() {
  try { const n = +localStorage.getItem('waypoint.cols'); return COLUMNS.includes(n) ? n : 3; } catch { return 3; }
}
export function saveCols(n) {
  try { localStorage.setItem('waypoint.cols', n); } catch { /* private window */ }
}
