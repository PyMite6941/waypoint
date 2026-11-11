import { useEffect, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Inspector from './components/Inspector.jsx';
import Show from './components/Show.jsx';
import SlideView, { Thumb } from './components/SlideView.jsx';
import Stage from './components/Stage.jsx';
import { H, THEMES, W, newDeck, newSlide, textEl, uid } from './lib/deck.js';
import { forgetPath, openDeck, pickImage, readImage, saveDeck } from './lib/files.js';
import { initState, reducer } from './lib/state.js';
import { listen, send, storeDeck } from './lib/store.js';

const typing = e => e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
const copyOf = el => ({ ...el, id: uid(), x: el.x + 20, y: el.y + 20 });
const ARROWS = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1], pageup: [0, -1], pagedown: [0, 1] };

export default function App({ initial }) {
  const [state, dispatch] = useReducer(reducer, initial, initState);
  const { deck, cur, sel } = state;
  const slide = deck.slides[cur], el = slide.els.find(e => e.id === sel);
  const [show, setShow] = useState(null);         // { at, fullscreen } while presenting
  const [editing, setEditing] = useState(null);   // id of the text element being typed in
  const [unsaved, setUnsaved] = useState(false);
  const [printing, setPrinting] = useState(false);
  const clip = useRef(null), editingRef = useRef(null), dragFrom = useRef(null);

  /* ---------- changing the deck ---------- */

  // New objects are always built outside these callbacks: reducers may run twice.
  const change = (fn, tag) => dispatch({ type: 'change', fn, tag });
  const onSlide = (fn, tag) => change(d => fn(d.deck.slides[d.cur], d), tag);
  const setEl = (key, value) => onSlide(sl => { const e = sl.els.find(x => x.id === sel); if (e) e[key] = value; }, `${key}:${sel}`);
  const setSlide = (key, value) => onSlide(sl => { sl[key] = value; }, `${key}:${slide.id}`);
  const addEl = made => onSlide((sl, d) => { sl.els.push(made); d.sel = made.id; });
  const insertSlide = made => change(d => { d.deck.slides.splice(d.cur + 1, 0, made); d.cur += 1; d.sel = null; });

  function startEdit(id) {
    editingRef.current = id;
    setEditing(id);
  }
  function finishEdit(id, text) {
    if (editingRef.current !== id) return;
    editingRef.current = null;
    setEditing(null);
    onSlide(sl => {
      const e = sl.els.find(x => x.id === id);
      if (!e) return;
      if (text.trim()) e.text = text; else sl.els = sl.els.filter(x => x !== e);   // an emptied text box is removed
    });
  }

  async function addImage(file) {
    let img;
    try { img = await readImage(file); } catch { return alert('That image could not be read.'); }
    const asset = uid(), k = Math.min(900 / img.w, 600 / img.h, 1), w = Math.round(img.w * k), h = Math.round(img.h * k);
    const made = { id: uid(), type: 'image', src: asset, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
    change(d => { d.deck.assets[asset] = img.src; d.deck.slides[d.cur].els.push(made); d.sel = made.id; });
  }

  const actions = {
    text() { const made = textEl('Text', 500, 400, 600, 70, 44); addEl(made); startEdit(made.id); },
    rect() { addEl({ id: uid(), type: 'rect', x: 600, y: 300, w: 400, h: 300 }); },
    ellipse() { addEl({ id: uid(), type: 'ellipse', x: 650, y: 300, w: 300, h: 300 }); },
    async image() { const file = await pickImage(); if (file) addImage(file); },
    undo() { dispatch({ type: 'undo' }); },
    redo() { dispatch({ type: 'redo' }); },
    dup() { if (el) addEl(copyOf(el)); },
    del() { if (el) onSlide((sl, d) => { sl.els = sl.els.filter(x => x.id !== sel); d.sel = null; }); },
    order(front) {
      onSlide(sl => {
        const [e] = sl.els.splice(sl.els.findIndex(x => x.id === sel), 1);
        if (front) sl.els.push(e); else sl.els.unshift(e);
      });
    },

    slide() { insertSlide(newSlide()); },
    dupSlide() { insertSlide({ ...structuredClone(slide), id: uid(), els: slide.els.map(e => ({ ...e, id: uid() })) }); },
    delSlide() {
      const blank = newSlide();
      change(d => { d.deck.slides.splice(d.cur, 1); if (!d.deck.slides.length) d.deck.slides.push(blank); d.sel = null; });
    },
    moveSlide(from, to) { change(d => { d.deck.slides.splice(to, 0, ...d.deck.slides.splice(from, 1)); d.cur = to; d.sel = null; }); },

    newDeck() {
      if (!confirm('Start a new deck? Save the current one to a file first if you want to keep it.')) return;
      forgetPath();
      dispatch({ type: 'load', deck: newDeck() });
    },
    async open() {
      try {
        const opened = await openDeck();
        if (opened) dispatch({ type: 'load', deck: opened });
      } catch {
        alert('That file is not a Waypoint deck.');
      }
    },
    save() { saveDeck(deck).catch(err => alert(`Could not save: ${err.message}`)); },
    pdf() { flushSync(() => setPrinting(true)); window.print(); },

    present() { setShow({ at: cur, fullscreen: true }); },
    presenter() {
      if (!window.open('?presenter', 'waypoint-presenter', 'width=1100,height=720')) alert('Allow pop-ups for this page to open Presenter view.');
    },
  };

  /* ---------- effects ---------- */

  // Save shortly after every change, then tell the presenter window to reload.
  useEffect(() => {
    const t = setTimeout(() => storeDeck(deck).then(() => { setUnsaved(false); send({ type: 'deck' }); }, () => setUnsaved(true)), 250);
    return () => clearTimeout(t);
  }, [deck]);
  useEffect(() => { document.title = `${deck.title || 'Untitled deck'} · Waypoint`; }, [deck.title]);
  useEffect(() => { if (!show) send({ type: 'state', i: cur }); }, [cur, show]);

  // Window-level behaviour. Handlers read the latest render through a ref, so listeners attach once.
  const live = useRef({});
  live.current = { actions, show, cur, sel, el, addEl, addImage, onSlide };
  useEffect(() => {
    const onKey = e => {
      const a = live.current;
      if (a.show) return;   // the show handles its own keys
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), arrow = ARROWS[k];
      if (mod && k === 's') { e.preventDefault(); return a.actions.save(); }
      if ((mod && k === 'enter') || k === 'f5') { e.preventDefault(); return a.actions.present(); }
      if (typing(e)) return;
      if (mod) {
        if (k === 'z') e.shiftKey ? a.actions.redo() : a.actions.undo();
        else if (k === 'y') a.actions.redo();
        else if (k === 'd') a.el ? a.actions.dup() : a.actions.dupSlide();
        else if (k === 'm') a.actions.slide();
        else { if (k === 'c' && a.el) clip.current = a.el; return; }
      } else if (k === 'escape') dispatch({ type: 'view' });
      else if ((k === 'delete' || k === 'backspace') && a.el) a.actions.del();
      else if (arrow && a.el && k.startsWith('arrow')) {
        const n = e.shiftKey ? 10 : 1, id = a.sel;
        a.onSlide(sl => { const x = sl.els.find(i => i.id === id); x.x += arrow[0] * n; x.y += arrow[1] * n; }, `nudge:${id}`);
      } else if (arrow) dispatch({ type: 'view', cur: a.cur + (arrow[0] || arrow[1]) });
      else return;
      e.preventDefault();
    };
    const onPaste = e => {
      const a = live.current;
      if (a.show || typing(e)) return;
      const image = [...e.clipboardData.files].find(f => f.type.startsWith('image/'));
      if (image) a.addImage(image); else if (clip.current) a.addEl(copyOf(clip.current));
    };
    const afterPrint = () => setPrinting(false);
    // Presenter view asked for a slide while no show is running: start one in this window.
    const stop = listen(m => {
      const a = live.current;
      if (a.show) return;
      if (m.type === 'hello') send({ type: 'state', i: a.cur });
      else if (m.type === 'goto') setShow({ at: m.i, fullscreen: false });
      else if (m.type === 'step') setShow({ at: a.cur + m.d, fullscreen: false });
      else if (m.type === 'back') setShow({ at: a.cur, fullscreen: false });
    });
    addEventListener('keydown', onKey);
    addEventListener('paste', onPaste);
    addEventListener('afterprint', afterPrint);
    return () => { stop(); removeEventListener('keydown', onKey); removeEventListener('paste', onPaste); removeEventListener('afterprint', afterPrint); };
  }, []);

  /* ---------- view ---------- */

  const closeMenu = e => e.currentTarget.closest('details').removeAttribute('open');

  return (
    <>
      <div id="app">
        <header id="bar">
          <input id="title" aria-label="Deck title" spellCheck={false} value={deck.title} onChange={e => change(d => { d.deck.title = e.target.value; }, 'title')} />
          <span className="group">
            <button onClick={actions.text}>Text</button>
            <button onClick={actions.rect}>Box</button>
            <button onClick={actions.ellipse}>Circle</button>
            <button onClick={actions.image}>Image</button>
          </span>
          <span className="group">
            <button onClick={actions.undo} disabled={!state.past.length} title="Undo (Ctrl+Z)">Undo</button>
            <button onClick={actions.redo} disabled={!state.future.length} title="Redo (Ctrl+Shift+Z)">Redo</button>
          </span>
          <select aria-label="Theme" value={deck.theme} onChange={e => change(d => { d.deck.theme = e.target.value; })}>
            {Object.entries(THEMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          {unsaved && <span id="saved">Not saved on this device. Use File, Save file.</span>}
          <span className="grow" />
          <details className="menu">
            <summary>File</summary>
            <div onClick={closeMenu}>
              <button onClick={actions.newDeck}>New deck</button>
              <button onClick={actions.open}>Open file</button>
              <button onClick={actions.save} title="Ctrl+S">Save file</button>
              <button onClick={actions.pdf}>Print or PDF</button>
              <a href="docs/" target="_blank" rel="noopener">Guide</a>
            </div>
          </details>
          <button onClick={actions.presenter} title="Notes, timer and slide picker in a second window">Presenter view</button>
          <button className="primary" onClick={actions.present} title="Present from this slide (Ctrl+Enter)">Present</button>
        </header>

        <div id="work">
          <aside id="side">
            <div className="sideBtns">
              <button onClick={actions.slide} title="New slide (Ctrl+M)">+ Slide</button>
              <button onClick={actions.dupSlide} title="Duplicate slide">Copy</button>
              <button onClick={actions.delSlide} title="Delete slide">Delete</button>
            </div>
            <div id="strip">
              {deck.slides.map((s, i) => (
                <button
                  key={s.id} className={i === cur ? 'on' : undefined} draggable
                  ref={i === cur ? n => n?.scrollIntoView({ block: 'nearest' }) : undefined}
                  onClick={() => dispatch({ type: 'view', cur: i })}
                  onDragStart={() => { dragFrom.current = i; }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); if (dragFrom.current !== null && dragFrom.current !== i) actions.moveSlide(dragFrom.current, i); dragFrom.current = null; }}
                >
                  <span>{i + 1}</span>
                  <Thumb deck={deck} slide={s} width={132} />
                </button>
              ))}
            </div>
          </aside>

          <section id="center">
            <Stage
              deck={deck} slide={slide} sel={sel} editing={editing}
              onSelect={id => dispatch({ type: 'view', sel: id })}
              onEdit={startEdit} onEditDone={finishEdit} onDropImage={addImage}
              onMove={(id, rect) => onSlide(sl => Object.assign(sl.els.find(x => x.id === id), rect))}
            />
            <textarea id="notes" placeholder="Speaker notes" aria-label="Speaker notes" value={slide.notes} onChange={e => setSlide('notes', e.target.value)} />
          </section>

          <Inspector deck={deck} cur={cur} el={el} setEl={setEl} setSlide={setSlide} actions={actions} />
        </div>
      </div>

      {show && <Show deck={deck} start={show.at} fullscreen={show.fullscreen} onExit={i => { setShow(null); dispatch({ type: 'view', cur: i }); }} />}
      {printing && <div id="print">{deck.slides.map(s => <div className="page" key={s.id}><SlideView deck={deck} slide={s} /></div>)}</div>}
    </>
  );
}
