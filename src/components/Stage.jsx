import { useState } from 'react';
import { H, W } from '../lib/deck.js';
import SlideView, { Fit } from './SlideView.jsx';

// Snap one axis of a dragged box to nearby lines. Tries the box's start, middle and end.
// Returns [snapped position, the line it snapped to], or [null, null].
function snap(pos, size, lines) {
  for (const offset of [0, size / 2, size]) {
    const line = lines.find(l => Math.abs(pos + offset - l) <= 8);
    if (line !== undefined) return [line - offset, line];
  }
  return [null, null];
}

// The editable slide: click to select, drag to move, drag a corner to resize,
// double-click text to edit.
// `preview` ({ ev, build, taps, n }) plays one moment in place: a build step or a trigger's click
// (see effects.js); objects show as they are at that moment and its effects run.
export default function Stage({ deck, slide, sel, editing, preview, onSelect, onEdit, onEditDone, onMove, onDropImage }) {
  const [live, setLive] = useState(null);     // rectangle of the element being dragged
  const [guides, setGuides] = useState(null); // alignment lines shown while it snaps: { x, y }

  function onPointerDown(e) {
    if (e.target.isContentEditable || e.button) return;
    const corner = e.target.dataset.corner;
    const id = e.target.closest('.el')?.dataset.id;
    const el = slide.els.find(x => x.id === id);
    if (!el) return onSelect(null);
    if (id !== sel) onSelect(id);

    const k = W / e.currentTarget.querySelector('.slide').getBoundingClientRect().width;   // screen px -> slide units
    const x0 = e.clientX, y0 = e.clientY;
    let rect = null;
    // Lines worth aligning to: the slide's edges and centre, and every other element's.
    const others = slide.els.filter(o => o.id !== id);
    const xs = [0, W / 2, W, ...others.flatMap(o => [o.x, o.x + o.w / 2, o.x + o.w])];
    const ys = [0, H / 2, H, ...others.flatMap(o => [o.y, o.y + o.h / 2, o.y + o.h])];
    const move = ev => {
      const dx = (ev.clientX - x0) * k, dy = (ev.clientY - y0) * k;
      if (!rect && Math.hypot(dx, dy) < 3) return;
      const grid = v => (ev.altKey ? Math.round(v) : Math.round(v / 10) * 10);   // Alt turns snapping off
      if (!corner) {
        const [sx, gx] = ev.altKey ? [null, null] : snap(el.x + dx, el.w, xs);
        const [sy, gy] = ev.altKey ? [null, null] : snap(el.y + dy, el.h, ys);
        rect = { x: sx ?? grid(el.x + dx), y: sy ?? grid(el.y + dy), w: el.w, h: el.h };
        setGuides({ x: gx, y: gy });
      } else {
        let x1 = el.x, y1 = el.y, x2 = el.x + el.w, y2 = el.y + el.h;
        if (corner[1] === 'w') x1 = Math.min(grid(x1 + dx), x2 - 20); else x2 = Math.max(grid(x2 + dx), x1 + 20);
        if (corner[0] === 'n') y1 = Math.min(grid(y1 + dy), y2 - 20); else y2 = Math.max(grid(y2 + dy), y1 + 20);
        if (el.type === 'image' || ev.shiftKey) {   // keep proportions, anchored on the opposite corner
          const h = (x2 - x1) * el.h / el.w;
          if (corner[0] === 'n') y1 = y2 - h; else y2 = y1 + h;
        }
        rect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      }
      setLive({ id, ...rect });
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      setLive(null);
      setGuides(null);
      if (rect) onMove(id, rect);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  return (
    <Fit
      className="stage"
      onPointerDown={onPointerDown}
      onDoubleClick={e => { const id = e.target.closest('.el.text')?.dataset.id; if (id) onEdit(id); }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        const images = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
        if (!images.length) return;   // anything else is a deck to import: the window handles it
        e.preventDefault();
        e.stopPropagation();
        images.forEach(onDropImage);
      }}
    >
      <SlideView
        key={preview ? `p${preview.n}` : 'edit'} deck={deck} slide={slide} sel={preview ? null : sel} live={live} guides={guides}
        editing={editing} onEditDone={onEditDone} badges={!preview}
        build={preview ? preview.build : undefined} taps={preview?.taps} fx={preview ? preview.ev : null} fxKey={preview?.n}
      />
    </Fit>
  );
}
