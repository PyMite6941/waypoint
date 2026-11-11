import { indexOfId, slideTitle } from '../lib/deck.js';

const KIND = { text: 'Text', rect: 'Box', ellipse: 'Circle', image: 'Image' };

function Colour({ label, value, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="color" value={value || '#888888'} onChange={e => onChange(e.target.value)} />
      <button disabled={!value} title="Use the theme colour" onClick={() => onChange('')}>Auto</button>
    </label>
  );
}

// The right-hand panel. Shows the selected element, or the slide when nothing is selected.
// `setEl(key, value)` and `setSlide(key, value)` write one property.
export default function Inspector({ deck, cur, el, setEl, setSlide, actions }) {
  const slide = deck.slides[cur];

  if (!el) {
    const toggle = (id, on) => setSlide('next', on ? [...slide.next, id] : slide.next.filter(x => x !== id));
    return (
      <aside id="props">
        <h2>Slide {cur + 1}</h2>
        <Colour label="Background" value={slide.bg} onChange={v => setSlide('bg', v)} />
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

  return (
    <aside id="props">
      <h2>{KIND[el.type]}</h2>
      {el.type === 'text' && <>
        <label className="field"><span>Size</span>
          <input type="number" min="8" max="400" value={el.size} onChange={e => setEl('size', Math.max(8, +e.target.value || 8))} />
        </label>
        <label className="field"><span>Bold</span>
          <input type="checkbox" checked={!!el.bold} onChange={e => setEl('bold', e.target.checked)} />
        </label>
        <label className="field"><span>Align</span>
          <select value={el.align || ''} onChange={e => setEl('align', e.target.value)}>
            <option value="">Left</option><option value="center">Centre</option><option value="right">Right</option>
          </select>
        </label>
        <Colour label="Colour" value={el.color} onChange={v => setEl('color', v)} />
      </>}
      {el.type !== 'image' && <Colour label="Fill" value={el.fill} onChange={v => setEl('fill', v)} />}
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
