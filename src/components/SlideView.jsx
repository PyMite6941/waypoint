import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GEOMS, H, W } from '../lib/deck.js';
import { EASES, animOf, customId, easeCss, isCustom, keyframeName, keyframesCss } from '../lib/anims.js';
import { BUILT_IN, KIND_NAMES, actsOf, startsAt, stateOf, triggersOf } from '../lib/effects.js';
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
// Effects (see effects.js): with `build` set (the slide's click count) and `taps` (how often
// each trigger object was clicked), objects show where and as their actions have left them,
// and the actions starting at `fx` play: a step number, or { on, step } for a trigger's click.
// Step 0 waits `fxDelay` seconds (the slide's transition). A new `fxKey` replays.
// `sel`, `live` (a rectangle overriding one element mid-drag), `guides`, `badges` and `editing` are only used by the stage.
const n2 = v => (Number.isFinite(+v) ? Math.round(+v * 100) / 100 : 0);
function SlideView({ deck, slide, sel, live, guides, editing, onEditDone, build, taps, fx = null, fxKey = 0, fxDelay = 0, badges }) {
  const bg = slide.bgImg && deck.assets[slide.bgImg]
    ? { background: `${slide.bg || 'var(--bg)'} url("${deck.assets[slide.bgImg]}") center / cover no-repeat` }
    : slide.bg ? { background: slide.bg } : undefined;
  const playable = build !== undefined;
  const ev = fx === null || fx === undefined ? null : typeof fx === 'number' ? { on: null, step: fx } : fx;
  const triggers = playable ? triggersOf(slide) : null;
  // Keyframes this slide needs while it plays: its custom animations, and one per moving object.
  const custom = {}, moves = [];
  const rendered = slide.els.map((el, index) => {
    if (!playable) return { el, g: el, visible: true };
    const now = stateOf(deck, el, build, taps);
    const act = ev && actsOf(deck, el).filter(a => startsAt(a, ev)).at(-1);   // the one that plays now
    if (!act) return { el, g: now.g, visible: now.visible };
    const own = isCustom(act.fx) ? animOf(deck, act.fx) : null;
    if (own) custom[customId(act.fx)] = own;
    const out = { el, g: now.g, visible: now.visible || act.kind === 'out', act, own };
    if (act.kind === 'move') {
      const was = stateOf(deck, el, build, taps, ev).g, g = now.g;
      const sx = was.w / (g.w || 1), sy = was.h / (g.h || 1), keep = el.type === 'text' ? Math.sqrt(sx * sy) : null;
      out.move = `wpm-${index}`;
      moves.push(`@keyframes wpm-${index} { from { translate: ${n2(was.x + was.w / 2 - (g.x + g.w / 2))}px ${n2(was.y + was.h / 2 - (g.y + g.h / 2))}px; scale: ${keep ? n2(keep) : `${n2(sx)} ${n2(sy)}`}; rotate: ${n2(was.rot - g.rot)}deg; } }`);
    }
    return out;
  });
  const css = (Object.keys(custom).length ? keyframesCss(custom) : '') + moves.join('\n');
  return (
    <div className={`slide t-${deck.theme}`}>
      {css && <style>{css}</style>}
      <div className="bgl" style={bg} />
      {rendered.map(({ el, g, visible, act, own, move }) => {
        const r = live?.id === el.id ? live : g;
        const hidden = !visible;
        const playing = !!act;
        const style = { left: r.x, top: r.y, width: r.w, height: r.h };
        const rot = live?.id === el.id ? el.rot : g.rot;
        if (rot) style.transform = `rotate(${rot}deg)`;
        if (el.opacity != null && el.opacity < 1) style.opacity = el.opacity;
        if (el.lineW && el.type !== 'line' && !el.path) style.border = `${el.lineW}px solid ${el.line || 'var(--fg)'}`;
        if (el.radius != null) style.borderRadius = el.radius;
        if (el.geom && el.type !== 'line') style.clipPath = clipOf(el.geom);
        let fxClass = '';
        if (playing) {
          const instant = act.fx === 'appear' || act.fx === 'out-vanish';
          style.animationDuration = `${instant ? 0.01 : act.dur || own?.dur || 0.5}s`;
          if (move) { style['--fx'] = move; style.animationTimingFunction = (EASES[act.fx] || EASES['ease-in-out'])[1]; }
          else if (own) { style['--fx'] = keyframeName(customId(act.fx)); style.animationTimingFunction = easeCss(own); }
          style.animationDelay = `${(!act.on && (act.step || 0) === 0 ? fxDelay : 0) + (act.delay || 0)}s`;
          const known = act.kind !== 'move' && !isCustom(act.fx) && (act.fx in (BUILT_IN[act.kind] || {}) || (act.kind === 'emphasis' && act.fx in BUILT_IN.in));
          const name = move ? 'move' : own ? 'custom' : known ? act.fx : act.kind === 'out' ? 'out-fade' : act.kind === 'emphasis' ? 'em-pulse' : 'fade';
          fxClass = ` fx fx-${name}${act.kind === 'out' ? ' leaving' : ''}${act.kind === 'move' || act.kind === 'emphasis' ? ' still' : ''}`;
        }
        const common = {
          'data-id': el.id,
          'data-link': el.link && deck.slides.some(s => s.id === el.link) ? el.link : undefined,
          'data-trigger': triggers?.has(el.id) ? '' : undefined,
        };
        const cls = `el ${el.type}${sel === el.id ? ' sel' : ''}${hidden ? ' pending' : ''}${triggers?.has(el.id) ? ' trigger' : ''}${fxClass}`;
        const key = playing ? `${el.id}~${fxKey}` : el.id;
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
            <div key={key} {...common} className={cls + (el.fill ? ' filled' : '')} style={style}>
              {/* The key remounts the node after an edit, so React never patches text the browser rewrote. */}
              <TextBody key={editing === el.id ? 'edit' : 'view'} el={el} editing={editing === el.id} onDone={onEditDone} />
              {handles}
            </div>
          );
        }
        if (el.type === 'image') {
          return <div key={key} {...common} className={cls} style={style}><Img src={deck.assets[el.src]} crop={el.crop} />{handles}</div>;
        }
        if (el.type === 'line') {
          return <div key={key} {...common} className={cls} style={style}><Line el={el} />{handles}</div>;
        }
        if (el.path) {   // a freeform outline (imported)
          const k = Math.sqrt((el.path.w / Math.max(el.w, 1)) * (el.path.h / Math.max(el.h, 1)));
          const flip = `${el.flip?.includes('h') ? `translate(${el.path.w} 0) scale(-1 1) ` : ''}${el.flip?.includes('v') ? `translate(0 ${el.path.h}) scale(1 -1)` : ''}`;
          return (
            <div key={key} {...common} className={`${cls} path`} style={style}>
              <svg width="100%" height="100%" viewBox={`0 0 ${el.path.w} ${el.path.h}`} preserveAspectRatio="none" overflow="visible">
                <path d={el.path.d} transform={flip || undefined} fill={el.fill || 'var(--accent)'} stroke={el.lineW ? el.line || 'var(--fg)' : 'none'} strokeWidth={(el.lineW || 0) * k} />
              </svg>
              {handles}
            </div>
          );
        }
        return <div key={key} {...common} className={cls} style={{ ...style, background: el.fill || undefined }}>{handles}</div>;
      })}
      {badges && slide.els.map(el => {
        const acts = actsOf(deck, el);
        if (!acts.length) return null;
        const label = acts.map(a => (a.on ? '⚡' : '') + (a.step || '◦')).join(' ');
        const title = acts.map(a => `${KIND_NAMES[a.kind]}: ${a.on ? `click ${a.step} on another object` : a.step ? `click ${a.step}` : 'with the slide'}`).join('\n');
        return <b key={`b${el.id}`} className="badge" style={{ left: el.x, top: el.y }} title={title}>{label}</b>;
      })}
      {badges && slide.els.filter(el => el.id === sel).flatMap(el => (el.acts || []).map((a, i) => a.kind === 'move' && a.to && (
        <i key={`m${i}`} className="moveTo" style={{ left: a.to.x, top: a.to.y, width: a.to.w, height: a.to.h, transform: a.to.rot ? `rotate(${a.to.rot}deg)` : undefined }}><b>Move {a.on ? `⚡${a.step}` : a.step || '◦'}</b></i>
      )))}
      {guides?.x != null && <i className="guide v" style={{ left: guides.x }} />}
      {guides?.y != null && <i className="guide h" style={{ top: guides.y }} />}
    </div>
  );
}

// A slide is redrawn only when something it shows changed: its own content, the theme, the
// pictures, or which slides exist (for link badges). Edits keep unchanged slides as the same
// objects (see state.js), so editing one slide leaves every other thumbnail alone.
const idsKey = new WeakMap();
const idsOf = slides => { let k = idsKey.get(slides); if (k === undefined) { k = slides.map(s => s.id).join(' '); idsKey.set(slides, k); } return k; };
const sameLook = (a, b) => a === b || (a.theme === b.theme && a.assets === b.assets && a.anims === b.anims && a.transitions === b.transitions && (a.slides === b.slides || idsOf(a.slides) === idsOf(b.slides)));
export function sameProps(p, n) {
  for (const k of new Set([...Object.keys(p), ...Object.keys(n)])) {
    if (k === 'deck' ? !sameLook(p.deck, n.deck) : p[k] !== n[k]) return false;
  }
  return true;
}
export default memo(SlideView, sameProps);

// A slide at a fixed small width.
export const Thumb = memo(function Thumb({ deck, slide, width }) {
  return (
    <div className="thumb" style={{ width, height: width * H / W }}>
      <div className="scaler" style={{ transform: `scale(${width / W})` }}><SlideView deck={deck} slide={slide} /></div>
    </div>
  );
}, sameProps);

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
