import { BUILDS, TRANSITIONS, buildSteps, indexOfId, slideTitle } from '../lib/deck.js';
import { FONT_CHOICES } from '../lib/fonts.js';

const KIND = { text: 'Text', rect: 'Box', ellipse: 'Circle', image: 'Image', line: 'Line' };
// <input type=color> only takes #rrggbb.
const hex6 = v => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : /^#[0-9a-f]{3}$/i.test(v || '') ? `#${[...v.slice(1)].map(c => c + c).join('')}` : '#888888');

function Colour({ label, value, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="color" value={hex6(value)} onChange={e => onChange(e.target.value)} />
      <button disabled={!value} title="Use the theme colour" onClick={() => onChange('')}>Auto</button>
    </label>
  );
}

function Num({ label, value, min, max, step = 1, onChange, unit }) {
  return (
    <label className="field"><span>{label}</span>
      <input type="number" min={min} max={max} step={step} value={value} onChange={e => onChange(Math.max(min, Math.min(max, +e.target.value || 0)))} />
      {unit && <em className="unit">{unit}</em>}
    </label>
  );
}

// Build (entrance) effect of one object.
function Animation({ slide, el, setEl, onPreview }) {
  const a = el.anim || {};
  const others = buildSteps({ els: slide.els.filter(e => e !== el) });
  const set = patch => setEl('anim', { fx: 'fade', step: Math.max(1, others + (a.fx ? 0 : 1)), dur: 0.5, ...a, ...patch });
  return (
    <>
      <h3>Build</h3>
      <label className="field"><span>Effect</span>
        <select value={a.fx || ''} onChange={e => (e.target.value ? set({ fx: e.target.value }) : setEl('anim', undefined))}>
          <option value="">None</option>
          {Object.entries(BUILDS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      {a.fx && <>
        <label className="field"><span>Starts</span>
          <select value={a.step || 0} onChange={e => set({ step: +e.target.value })}>
            <option value={0}>With the slide</option>
            {Array.from({ length: others + 1 }, (_, n) => <option key={n} value={n + 1}>On click {n + 1}</option>)}
          </select>
        </label>
        {a.fx !== 'appear' && <Num label="Duration" value={a.dur ?? 0.5} min={0.1} max={10} step={0.1} unit="s" onChange={v => set({ dur: v })} />}
        <Num label="Delay" value={a.delay || 0} min={0} max={30} step={0.1} unit="s" onChange={v => set({ delay: v })} />
        <button onClick={() => onPreview(a.step || 0)}>Preview build</button>
      </>}
    </>
  );
}

// The right-hand panel. Shows the selected element, or the slide when nothing is selected.
// `setEl(key, value)` and `setSlide(key, value)` write one property.
export default function Inspector({ deck, cur, el, setEl, setSlide, actions }) {
  const slide = deck.slides[cur];

  if (!el) {
    const toggle = (id, on) => setSlide('next', on ? [...slide.next, id] : slide.next.filter(x => x !== id));
    const t = slide.trans || { fx: 'none', dur: 0.6 };
    return (
      <aside id="props">
        <h2>Slide {cur + 1}</h2>
        <Colour label="Background" value={slide.bg} onChange={v => setSlide('bg', v)} />
        <div className="field"><span>Picture</span>
          <button onClick={actions.bgImage}>{slide.bgImg ? 'Change' : 'Choose'}</button>
          {slide.bgImg && <button onClick={() => setSlide('bgImg', undefined)}>Remove</button>}
        </div>

        <h3>Transition</h3>
        <label className="field"><span>Effect</span>
          <select value={t.fx} onChange={e => setSlide('trans', e.target.value === 'none' ? undefined : { ...t, fx: e.target.value })}>
            {Object.entries(TRANSITIONS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        {t.fx !== 'none' && <>
          <Num label="Duration" value={t.dur} min={0.1} max={5} step={0.1} unit="s" onChange={v => setSlide('trans', { ...t, dur: v })} />
          {t.fx === 'morph' && <p className="hint">Objects that are on the previous slide too (same text, picture or shape) glide to their new place. Duplicate a slide, move things, then pick Morph.</p>}
          <div className="row">
            <button onClick={actions.preview}>Preview</button>
            <button onClick={() => actions.transitionAll(slide.trans)}>Use on all slides</button>
          </div>
        </>}

        <h3>Next choices</h3>
        <p className="hint">Slides offered as one-click jumps from this slide while presenting.</p>
        {deck.slides.map((other, i) => other !== slide && (
          <label className="check" key={other.id}>
            <input type="checkbox" checked={slide.next.includes(other.id)} onChange={e => toggle(other.id, e.target.checked)} />
            {i + 1} · {slideTitle(other)}
          </label>
        ))}
      </aside>
    );
  }

  const fonts = el.font && !FONT_CHOICES.includes(el.font) ? [el.font, ...FONT_CHOICES] : FONT_CHOICES;
  return (
    <aside id="props">
      <h2>{KIND[el.type] || 'Object'}</h2>
      {el.type === 'text' && <>
        <label className="field"><span>Font</span>
          <select value={el.font || ''} onChange={e => setEl('font', e.target.value || undefined)}>
            <option value="">Theme font</option>
            {fonts.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <Num label="Size" value={el.size} min={8} max={400} onChange={v => setEl('size', Math.max(8, v))} />
        <div className="field"><span>Style</span>
          <span className="toggles">
            <button className={el.bold ? 'on' : undefined} aria-pressed={!!el.bold} title="Bold (Ctrl+B)" onClick={() => setEl('bold', !el.bold)}><b>B</b></button>
            <button className={el.italic ? 'on' : undefined} aria-pressed={!!el.italic} title="Italic (Ctrl+I)" onClick={() => setEl('italic', !el.italic)}><i>I</i></button>
            <button className={el.underline ? 'on' : undefined} aria-pressed={!!el.underline} title="Underline (Ctrl+U)" onClick={() => setEl('underline', !el.underline)}><u>U</u></button>
          </span>
        </div>
        <label className="field"><span>Align</span>
          <select value={el.align || ''} onChange={e => setEl('align', e.target.value)}>
            <option value="">Left</option><option value="center">Centre</option><option value="right">Right</option><option value="justify">Justify</option>
          </select>
        </label>
        <label className="field"><span>Vertical</span>
          <select value={el.valign || ''} onChange={e => setEl('valign', e.target.value || undefined)}>
            <option value="">{el.fill ? 'Middle' : 'Top'}</option><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option>
          </select>
        </label>
        <Colour label="Colour" value={el.color} onChange={v => setEl('color', v)} />
      </>}
      {el.type !== 'image' && el.type !== 'line' && <Colour label="Fill" value={el.fill} onChange={v => setEl('fill', v)} />}
      {el.type === 'line'
        ? <Colour label="Colour" value={el.line} onChange={v => setEl('line', v)} />
        : <Colour label="Outline" value={el.line} onChange={v => { setEl('line', v); if (v && !el.lineW) setEl('lineW', 4); }} />}
      <Num label={el.type === 'line' ? 'Thickness' : 'Outline'} value={el.lineW || 0} min={0} max={60} unit="px" onChange={v => setEl('lineW', v || undefined)} />
      {el.type === 'rect' && !el.geom && <Num label="Corners" value={el.radius ?? 10} min={0} max={450} unit="px" onChange={v => setEl('radius', v)} />}
      <Num label="Rotate" value={el.rot || 0} min={-360} max={360} unit="°" onChange={v => setEl('rot', v || undefined)} />
      <label className="field"><span>Opacity</span>
        <input type="range" min="0.05" max="1" step="0.05" value={el.opacity ?? 1} onChange={e => setEl('opacity', +e.target.value >= 1 ? undefined : +e.target.value)} />
      </label>

      <Animation slide={slide} el={el} setEl={setEl} onPreview={actions.previewBuild} />

      <h3>Link</h3>
      <label className="field"><span>Links to</span>
        <select value={indexOfId(deck, el.link) >= 0 ? el.link : ''} onChange={e => setEl('link', e.target.value)}>
          <option value="">None</option>
          {deck.slides.map((s, i) => <option key={s.id} value={s.id}>{i + 1} · {slideTitle(s)}</option>)}
        </select>
      </label>
      <p className="hint">While presenting, clicking this jumps to the linked slide.</p>
      <div className="row"><button onClick={() => actions.order(true)}>To front</button><button onClick={() => actions.order(false)}>To back</button></div>
      <div className="row"><button onClick={actions.dup}>Duplicate</button><button onClick={actions.del}>Delete</button></div>
    </aside>
  );
}
