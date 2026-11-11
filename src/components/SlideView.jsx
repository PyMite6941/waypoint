import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { H, W } from '../lib/deck.js';

const CORNERS = ['nw', 'ne', 'sw', 'se'];

// Text of one element. While `editing` it is a plain-text editable region that
// reports its content once, on blur.
function TextBody({ el, editing, onDone }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!editing) return;
    ref.current.focus();
    getSelection().selectAllChildren(ref.current);
  }, [editing]);
  if (!editing) return <div className="t">{el.text}</div>;
  return (
    <div
      ref={ref} className="t" contentEditable="plaintext-only" suppressContentEditableWarning
      onBlur={e => onDone(el.id, e.currentTarget.innerText.replace(/\n+$/, ''))}
      onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.blur(); }}
    >{el.text}</div>
  );
}

// One slide at its natural 1600 x 900 size. Everything that shows a slide uses this:
// the stage, thumbnails, the show, presenter view and print.
// `sel`, `live` (a rectangle overriding one element mid-drag) and `editing` are only used by the stage.
export default function SlideView({ deck, slide, sel, live, editing, onEditDone }) {
  return (
    <div className={`slide t-${deck.theme}`} style={slide.bg ? { background: slide.bg } : undefined}>
      {slide.els.map(el => {
        const r = live?.id === el.id ? live : el;
        const box = { left: r.x, top: r.y, width: r.w, height: r.h };
        const common = {
          'data-id': el.id,
          'data-link': el.link && deck.slides.some(s => s.id === el.link) ? el.link : undefined,
        };
        const cls = `el ${el.type}${sel === el.id ? ' sel' : ''}`;
        const handles = sel === el.id && editing !== el.id && CORNERS.map(c => <i key={c} className={`handle ${c}`} data-corner={c} />);

        if (el.type === 'text') {
          const style = { ...box, fontSize: el.size, fontWeight: el.bold ? 700 : undefined, textAlign: el.align || undefined, color: el.color || undefined, background: el.fill || undefined };
          return (
            <div key={el.id} {...common} className={cls + (el.fill ? ' filled' : '')} style={style}>
              {/* The key remounts the node after an edit, so React never patches text the browser rewrote. */}
              <TextBody key={editing === el.id ? 'edit' : 'view'} el={el} editing={editing === el.id} onDone={onEditDone} />
              {handles}
            </div>
          );
        }
        if (el.type === 'image') {
          return <div key={el.id} {...common} className={cls} style={box}><img src={deck.assets[el.src]} alt="" draggable={false} />{handles}</div>;
        }
        return <div key={el.id} {...common} className={cls} style={{ ...box, background: el.fill || undefined }}>{handles}</div>;
      })}
    </div>
  );
}

// A slide at a fixed small width.
export function Thumb({ deck, slide, width }) {
  return (
    <div className="thumb" style={{ width, height: width * H / W }}>
      <div className="scaler" style={{ transform: `scale(${width / W})` }}><SlideView deck={deck} slide={slide} /></div>
    </div>
  );
}

// Scales its child slide to fill whatever space the box has. --k lets CSS draw
// selection handles at a constant size on screen.
export function Fit({ children, className = '', ...rest }) {
  const ref = useRef(null);
  const [k, setK] = useState(0);
  useLayoutEffect(() => {
    const box = ref.current;
    const measure = () => setK(Math.min(box.clientWidth / W, box.clientHeight / H));
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    measure();
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={`fit ${className}`} style={{ '--k': k ? 1 / k : 1 }} {...rest}>
      {k > 0 && <div className="scaler" style={{ transform: `translate(-50%, -50%) scale(${k})` }}>{children}</div>}
    </div>
  );
}
