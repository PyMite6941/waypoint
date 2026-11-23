import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GEOMS, H, W } from '../lib/deck.js';
import { fontStack } from '../lib/fonts.js';

const CORNERS = ['nw', 'ne', 'sw', 'se'];
const VALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
const clipOf = geom => GEOMS[geom] && `polygon(${GEOMS[geom].map(([x, y]) => `${x * 100}% ${y * 100}%`).join(', ')})`;

// Rich text: paragraphs of styled runs (mostly from imported files).
function Rich({ el }) {
  return el.rich.map((p, n) => {
    const size = p.size || p.runs.find(r => r.size)?.size;
    const style = { textAlign: p.align || undefined, fontSize: size, '--lvl': p.lvl || 0, marginTop: p.before || undefined };
    return (
      <div key={n} className={`p${p.bullet ? ' bul' : ''}`} style={style}>
        {p.bullet && <span className="bu">{p.bullet}</span>}
        {p.runs.length ? p.runs.map((r, j) => (
          <span key={j} style={{
            fontWeight: r.b === undefined ? undefined : r.b ? 700 : 400, fontStyle: r.i === undefined ? undefined : r.i ? 'italic' : 'normal',
            textDecoration: r.u ? 'underline' : undefined, color: r.color || undefined, fontSize: r.size || undefined,
            fontFamily: r.font ? fontStack(r.font) : undefined,
          }}>{r.t}</span>
        )) : '​'}
      </div>
    );
  });
}

// Text of one element. While `editing` it is a plain-text editable region that
// reports its content once, on blur.
function TextBody({ el, editing, onDone }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!editing) return;
    ref.current.focus();
    getSelection().selectAllChildren(ref.current);
  }, [editing]);
  if (!editing) return <div className="t">{el.rich?.length ? <Rich el={el} /> : el.text}</div>;
  return (
    <div
      ref={ref} className="t" contentEditable="plaintext-only" suppressContentEditableWarning
      onBlur={e => onDone(el.id, e.currentTarget.innerText.replace(/\n+$/, ''))}
      onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.blur(); }}
    >{el.text}</div>
  );
}

// Image, optionally cropped: [left, top, right, bottom] as fractions of the original.
function Img({ src, crop }) {
  if (!crop?.some(Boolean)) return <img src={src} alt="" draggable={false} />;
  const [l, t, r, b] = crop, w = 1 - l - r || 1, h = 1 - t - b || 1;
  return <img src={src} alt="" draggable={false} style={{ position: 'absolute', width: `${100 / w}%`, height: `${100 / h}%`, left: `${-l / w * 100}%`, top: `${-t / h * 100}%` }} />;
}

function Line({ el }) {
  const w = Math.max(el.w, 1), h = Math.max(el.h, 1), fh = el.flip?.includes('h'), fv = el.flip?.includes('v');
  const sw = el.lineW || 4, id = `a${el.id}`;
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" overflow="visible">
      {el.arrow && <defs><marker id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill={el.line || 'var(--fg)'} /></marker></defs>}
      <line x1={fh ? w : 0} y1={fv ? h : 0} x2={fh ? 0 : w} y2={fv ? 0 : h} stroke={el.line || 'var(--fg)'} strokeWidth={sw} strokeLinecap="round"
        markerEnd={el.arrow === 'end' || el.arrow === 'both' ? `url(#${id})` : undefined} markerStart={el.arrow === 'start' || el.arrow === 'both' ? `url(#${id})` : undefined} />
    </svg>
  );
}

// One slide at its natural 1600 x 900 size. Everything that shows a slide uses this:
// the stage, thumbnails, the show, presenter view and print.
// Builds: with `build` set, objects whose build step is later stay hidden, and objects of
// step `fx` play their entrance effect (step 0 after `fxDelay` seconds, the slide's transition).
// `sel`, `live` (a rectangle overriding one element mid-drag), `guides`, `badges` and `editing` are only used by the stage.
export default function SlideView({ deck, slide, sel, live, guides, editing, onEditDone, build, fx = null, fxDelay = 0, badges }) {
  const bg = slide.bgImg && deck.assets[slide.bgImg]
    ? { background: `${slide.bg || 'var(--bg)'} url("${deck.assets[slide.bgImg]}") center / cover no-repeat` }
    : slide.bg ? { background: slide.bg } : undefined;
  return (
    <div className={`slide t-${deck.theme}`}>
      <div className="bgl" style={bg} />
      {slide.els.map(el => {
        const r = live?.id === el.id ? live : el;
        const step = el.anim?.fx ? el.anim.step || 0 : -1;
        const hidden = build !== undefined && step > build;
        const playing = !hidden && fx !== null && build !== undefined && step === fx;
        const style = { left: r.x, top: r.y, width: r.w, height: r.h };
        if (el.rot) style.transform = `rotate(${el.rot}deg)`;
        if (el.opacity != null && el.opacity < 1) style.opacity = el.opacity;
        if (el.lineW && el.type !== 'line' && !el.path) style.border = `${el.lineW}px solid ${el.line || 'var(--fg)'}`;
        if (el.radius != null) style.borderRadius = el.radius;
        if (el.geom && el.type !== 'line') style.clipPath = clipOf(el.geom);
        if (playing) {
          style.animationDuration = `${el.anim.fx === 'appear' ? 0.01 : el.anim.dur || 0.5}s`;
          style.animationDelay = `${(step === 0 ? fxDelay : 0) + (el.anim.delay || 0)}s`;
        }
        const common = {
          'data-id': el.id,
          'data-link': el.link && deck.slides.some(s => s.id === el.link) ? el.link : undefined,
        };
        const cls = `el ${el.type}${sel === el.id ? ' sel' : ''}${hidden ? ' pending' : ''}${playing ? ` fx fx-${el.anim.fx}` : ''}`;
        const handles = sel === el.id && editing !== el.id && CORNERS.map(c => <i key={c} className={`handle ${c}`} data-corner={c} />);

        if (el.type === 'text') {
          Object.assign(style, {
            fontSize: el.size, fontWeight: el.bold ? 700 : undefined, fontStyle: el.italic ? 'italic' : undefined,
            textDecoration: el.underline ? 'underline' : undefined, textAlign: el.align || undefined, color: el.color || undefined,
            background: el.fill || undefined, fontFamily: el.font ? fontStack(el.font) : undefined, lineHeight: el.lh || undefined,
            justifyContent: VALIGN[el.valign], whiteSpace: el.nowrap ? 'pre' : undefined,
            padding: el.pad ? el.pad.map(v => `${v}px`).join(' ') : undefined,
          });
          return (
            <div key={el.id} {...common} className={cls + (el.fill ? ' filled' : '')} style={style}>
              {/* The key remounts the node after an edit, so React never patches text the browser rewrote. */}
              <TextBody key={editing === el.id ? 'edit' : 'view'} el={el} editing={editing === el.id} onDone={onEditDone} />
              {handles}
            </div>
          );
        }
        if (el.type === 'image') {
          return <div key={el.id} {...common} className={cls} style={style}><Img src={deck.assets[el.src]} crop={el.crop} />{handles}</div>;
        }
        if (el.type === 'line') {
          return <div key={el.id} {...common} className={cls} style={style}><Line el={el} />{handles}</div>;
        }
        if (el.path) {   // a freeform outline (imported)
          const k = Math.sqrt((el.path.w / Math.max(el.w, 1)) * (el.path.h / Math.max(el.h, 1)));
          const flip = `${el.flip?.includes('h') ? `translate(${el.path.w} 0) scale(-1 1) ` : ''}${el.flip?.includes('v') ? `translate(0 ${el.path.h}) scale(1 -1)` : ''}`;
          return (
            <div key={el.id} {...common} className={`${cls} path`} style={style}>
              <svg width="100%" height="100%" viewBox={`0 0 ${el.path.w} ${el.path.h}`} preserveAspectRatio="none" overflow="visible">
                <path d={el.path.d} transform={flip || undefined} fill={el.fill || 'var(--accent)'} stroke={el.lineW ? el.line || 'var(--fg)' : 'none'} strokeWidth={(el.lineW || 0) * k} />
              </svg>
              {handles}
            </div>
          );
        }
        return <div key={el.id} {...common} className={cls} style={{ ...style, background: el.fill || undefined }}>{handles}</div>;
      })}
      {badges && slide.els.map(el => el.anim?.fx && (
        <b key={`b${el.id}`} className="badge" style={{ left: el.x, top: el.y }} title="Build order">{el.anim.step || '◦'}</b>
      ))}
      {guides?.x != null && <i className="guide v" style={{ left: guides.x }} />}
      {guides?.y != null && <i className="guide h" style={{ top: guides.y }} />}
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
