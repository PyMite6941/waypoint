import { Suspense, lazy, useEffect, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AboutDialog, EXPORTS, ExportDialog, ImportDialog, InstallDialog, UninstallDialog, UpdateBar, preferredExport } from './components/FileDialogs.jsx';
import { onOpenFiles } from './lib/install.js';
import ClickerDialog from './components/ClickerDialog.jsx';
import ClickerMenu from './components/ClickerMenu.jsx';
import Inspector from './components/Inspector.jsx';
import LightTable, { ColumnSwitch, saveCols, savedCols } from './components/LightTable.jsx';
import Presenter from './components/Presenter.jsx';
import Show from './components/Show.jsx';
import SlideView, { Thumb } from './components/SlideView.jsx';
import Stage from './components/Stage.jsx';
import { H, LAYOUTS, PLACEHOLDER, THEMES, W, layoutSlide, newDeck, newSlide, textEl, uid } from './lib/deck.js';
import { isDeckFile } from './lib/convert/import.js';
import { fileName, forgetPath, openDeck, pickImage, readDropped, readImage, saveDeck, saveFile } from './lib/files.js';
import { loadFonts } from './lib/fonts.js';
import { subscribe } from './lib/updates.js';
import { closeAudience, openAudience } from './lib/present.js';
import { initState, reducer } from './lib/state.js';
import { library, saveToLibrary, transitionLibrary } from './lib/anims.js';
import { copyEls, geomOf, longestAt, retarget, slideSteps } from './lib/effects.js';
import { listen, send, storeDeck } from './lib/store.js';

// The AI dialogs (and the key store behind them) load the first time one is opened.
const AiGenerate = lazy(() => import('./components/AiDialogs.jsx').then(m => ({ default: m.AiGenerate })));
const AiSettings = lazy(() => import('./components/AiDialogs.jsx').then(m => ({ default: m.AiSettings })));
const AnimEditor = lazy(() => import('./components/AnimEditor.jsx'));
const TemplatesDialog = lazy(() => import('./components/TemplatesDialog.jsx'));
const TransitionEditor = lazy(() => import('./components/TransitionEditor.jsx'));
const firstLine = text => String(text || '').trim().split('\n')[0].slice(0, 40);

const typing = e => e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
const copyOf = el => ({ ...el, id: uid(), x: el.x + 20, y: el.y + 20 });
const remembered = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private window */ } };

const Pencil = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const Sparkle = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9Z" /><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z" />
  </svg>
);

const SHORTCUTS = [
  ['Everywhere', [['Ctrl+E', 'Edit mode on or off'], ['Ctrl+Enter or F5', 'Present'], ['Ctrl+O', 'Open or import (PowerPoint, Google Slides, PDF…)'], ['Ctrl+S', 'Save file'],
    ['Ctrl+Shift+S', 'Export in your preferred format'], ['Ctrl+G', 'Generate slides with AI'], ['?', 'This list']]],
  ['Edit mode', [['Ctrl+M', 'New slide'], ['Ctrl+D', 'Duplicate object, or slide'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+B / I / U', 'Bold, italic, underline'], ['Ctrl+] / Ctrl+[', 'Bring to front / send to back'],
    ['Arrows', 'Nudge object (Shift: 10x), or change slide'], ['Delete', 'Delete object'], ['Double-click', 'Edit text'], ['Alt while dragging', 'No snapping'], ['Shift while resizing', 'Keep proportions']]],
  ['Present mode', [['Arrows', 'Move around the slides'], ['Enter', 'Present from the ringed slide'], ['Double-click', 'Edit that slide']]],
  ['While presenting', [['→ Space Page Down / ← Page Up', 'Next build or slide / previous (clicker)'], ['Number, Enter', 'Jump to slide'], ['Backspace', 'Back to where you jumped from'], ['B or .', 'Black screen'], ['Esc', 'End the show']]],
];

const ARROWS = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1], pageup: [0, -1], pagedown: [0, 1] };

export default function App({ initial }) {
  const [state, dispatch] = useReducer(reducer, initial, initState);
  const { deck, cur, sel } = state;
  const slide = deck.slides[cur], el = slide.els.find(e => e.id === sel);
  const [show, setShow] = useState(null);         // { at, fullscreen } while presenting in this window
  const [control, setControl] = useState(null);   // { at, where } while this window drives the audience window
  const [notice, setNotice] = useState('');
  // Edit mode: the full editor. Present mode: every slide on a light table, ready to show.
  const [editMode, setEditModeState] = useState(() => remembered('waypoint.edit', '1') === '1');
  const setEditMode = on => { setEditModeState(on); remember('waypoint.edit', on ? '1' : '0'); if (!on) dispatch({ type: 'view', sel: null }); };
  const [cols, setColsState] = useState(savedCols);
  const setCols = n => { setColsState(n); saveCols(n); };
  const [ai, setAi] = useState(false);              // the Generate dialog is open
  const [animEdit, setAnimEdit] = useState(null);   // the custom animation editor is open: { start, target }
  const [transEdit, setTransEdit] = useState(null); // the custom transition editor is open: { start }
  const [recording, setRecording] = useState(null); // dragging an object to where a Move takes it: { id, slide, at, orig }
  const [aiSettings, setAiSettings] = useState(null); // the AI settings dialog is open: called with the result
  const [help, setHelp] = useState(false);
  const [dialog, setDialog] = useState(null);       // 'import' | 'export' | 'about'
  const [busy, setBusy] = useState('');             // what a long import or export is doing
  const [update, setUpdate] = useState(null);       // newest update state (see lib/updates.js)
  const [updateLater, setUpdateLater] = useState(false);
  const [preview, setPreview] = useState(null);     // { ev, build, taps, n }: a moment of the slide playing on the stage
  const [rendering, setRendering] = useState(false); // slides drawn off screen for picture export
  const [editing, setEditing] = useState(null);   // id of the text element being typed in
  const [unsaved, setUnsaved] = useState(false);
  const [printing, setPrinting] = useState(false);
  const clip = useRef(null), editingRef = useRef(null), dragFrom = useRef(null);
  // Keep the open slide in view in the strip (when it changes, not on every edit).
  useEffect(() => { document.querySelector('#strip > .on')?.scrollIntoView({ block: 'nearest' }); }, [cur, editMode]);

  /* ---------- changing the deck ---------- */

  // New objects are always built outside these callbacks: reducers may run twice.
  const change = (fn, tag) => dispatch({ type: 'change', fn, tag });
  const onSlide = (fn, tag) => change(d => fn(d.deck.slides[d.cur], d), tag);
  // Setting a text style on a whole object clears the same style on its rich text runs, so the change shows.
  const RUN_KEYS = { bold: 'b', italic: 'i', underline: 'u', color: 'color', size: 'size', font: 'font' };
  const setEl = (key, value) => onSlide(sl => {
    const e = sl.els.find(x => x.id === sel);
    if (!e) return;
    if (value === undefined) delete e[key]; else e[key] = value;
    for (const p of e.rich || []) {
      if (key === 'align') delete p.align;
      if (key === 'size') delete p.size;
      if (RUN_KEYS[key]) for (const r of p.runs) delete r[RUN_KEYS[key]];
    }
  }, `${key}:${sel}`);
  const setSlide = (key, value) => onSlide(sl => { if (value === undefined) delete sl[key]; else sl[key] = value; }, `${key}:${slide.id}`);
  // A pasted object keeps its triggers only where the trigger object is on this slide.
  const addEl = made => onSlide((sl, d) => {
    sl.els.push(made);
    const e = sl.els.at(-1);
    retarget([e], id => (sl.els.some(x => x.id === id && x !== e) || id === e.id ? id : undefined));
    d.sel = made.id;
  });
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
      if (!text.trim()) sl.els = sl.els.filter(x => x !== e);   // an emptied text box is removed
      else if (text !== e.text) { e.text = text; delete e.rich; }   // retyped: rich formatting gives way to the object's style
    });
  }

  async function addImage(file) {
    let img;
    try { img = await readImage(file); } catch { return alert('That image could not be read.'); }
    const asset = uid(), k = Math.min(900 / img.w, 600 / img.h, 1), w = Math.round(img.w * k), h = Math.round(img.h * k);
    const made = { id: uid(), type: 'image', src: asset, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
    change(d => { d.deck.assets[asset] = img.src; d.deck.slides[d.cur].els.push(made); d.sel = made.id; });
  }

  // Puts custom animation `id` on the selected object: on its entrance (`at` 'entrance'),
  // or on action number `at` of el.acts. A new entrance plays on the next free click.
  const putAnim = (d, id, anim, at = 'entrance') => {
    const sl = d.deck.slides[d.cur], e = sl.els.find(x => x.id === d.sel);
    if (!e) return;
    if (at === 'entrance') {
      const others = slideSteps({ els: sl.els.filter(x => x !== e) });
      e.anim = { ...e.anim, fx: `custom:${id}`, step: e.anim?.fx ? e.anim.step || 0 : Math.max(1, others + 1), dur: anim.dur };
    } else if (e.acts?.[at]) Object.assign(e.acts[at], { fx: `custom:${id}`, dur: anim.dur });
  };
  const putTransition = (d, id, t) => { d.deck.slides[d.cur].trans = { fx: `custom:${id}`, dur: t.dur }; };
  // Ends "set a Move by dragging": keep where the object was dragged to as the Move's end (or not), put it back.
  const endRecording = keep => {
    const r = recording;
    setRecording(null);
    if (!r) return;
    change(d => {
      const e = d.deck.slides.find(s => s.id === r.slide)?.els.find(x => x.id === r.id);
      if (!e) return;
      const act = e.acts?.[r.at];
      if (keep && act?.kind === 'move') act.to = geomOf(e);
      Object.assign(e, r.orig);
      if (!r.orig.rot) delete e.rot;
    });
  };
  const actions = {
    // Custom animations: make or change one, or bring one in from My animations.
    // `target`: { at: 'entrance' | index of the action, kind } where it goes.
    editAnim(id, target = { at: 'entrance', kind: 'in' }) { setAnimEdit({ start: id && deck.anims?.[id] ? { id, anim: deck.anims[id] } : null, target }); },
    saveAnim(id, anim, { library: keep }) {
      if (keep) saveToLibrary(id, anim);
      const at = animEdit?.target?.at;
      change(d => { d.deck.anims = { ...d.deck.anims, [id]: anim }; putAnim(d, id, anim, at); });
      setAnimEdit(null);
    },
    useAnim(id, at = 'entrance') {
      const anim = library()[id];
      if (anim) change(d => { d.deck.anims = { ...d.deck.anims, [id]: anim }; putAnim(d, id, anim, at); });
    },
    // Custom transitions, the same way, on the current slide.
    editTransition(id) { setTransEdit({ start: id && deck.transitions?.[id] ? { id, t: deck.transitions[id] } : null }); },
    saveTransition(id, t, { library: keep }) {
      if (keep) transitionLibrary.save(id, t);
      change(d => { d.deck.transitions = { ...d.deck.transitions, [id]: t }; putTransition(d, id, t); });
      setTransEdit(null);
    },
    useTransition(id) {
      const t = transitionLibrary.read()[id];
      if (t) change(d => { d.deck.transitions = { ...d.deck.transitions, [id]: t }; putTransition(d, id, t); });
    },
    // Set where Move action `at` of the selected object goes by dragging the object there.
    recordMove(at) {
      if (!el?.acts?.[at] || recording) return;
      const orig = geomOf(el), to = el.acts[at].to || orig;
      setRecording({ id: el.id, slide: slide.id, at, orig });
      onSlide(sl => Object.assign(sl.els.find(x => x.id === el.id), { x: to.x, y: to.y, w: to.w, h: to.h, rot: to.rot || 0 }));
    },
    endRecording,
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

    slide(kind = 'bullets') { insertSlide(layoutSlide(kind, PLACEHOLDER[kind])); },
    generate() { setEditMode(true); setAi(true); },
    settings(then) { setAiSettings(() => then || (() => {})); },
    bold() { if (el?.type === 'text') setEl('bold', !el.bold); },
    italic() { if (el?.type === 'text') setEl('italic', !el.italic); },
    underline() { if (el?.type === 'text') setEl('underline', !el.underline); },
    async bgImage() {
      const file = await pickImage();
      if (!file) return;
      let img;
      try { img = await readImage(file); } catch { return alert('That image could not be read.'); }
      const asset = uid();
      onSlide((sl, d) => { d.deck.assets[asset] = img.src; sl.bgImg = asset; });
    },
    transitionAll(t) { change(d => { for (const sl of d.deck.slides) { if (t) sl.trans = { ...t }; else delete sl.trans; } }); setNotice('Every slide now uses this transition.'); },
    preview() { setShow({ at: cur, fullscreen: false, enter: true }); },
    // Play one moment of the slide on the stage: build step `ev` (a number) or a trigger's click ({ on, step }).
    previewBuild(ev) {
      if (recording) return;
      const n = Date.now(), e = typeof ev === 'number' ? { on: null, step: ev } : ev;
      setPreview(e.on ? { ev: e, build: slideSteps(slide), taps: { [e.on]: e.step }, n } : { ev: e, build: e.step, taps: {}, n });
      setTimeout(() => setPreview(p => (p?.n === n ? null : p)), longestAt(deck, slide, e) * 1000 + 700);
    },
    // AI slides go in as one change, so a single Undo takes them all out.
    insertSlides(made, mode, title) {
      change(d => {
        if (mode === 'replace') { d.deck.slides = made; d.cur = 0; if (title) d.deck.title = title; }
        else { d.deck.slides.splice(d.cur + 1, 0, ...made); d.cur += 1; }
        d.sel = null;
      });
    },
    dupSlide() { insertSlide({ ...structuredClone(slide), id: uid(), els: copyEls(slide.els, uid) }); },
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
    open() { setDialog('import'); },
    // Import files (any supported format) as the deck or after the current slide.
    async importFiles(files, mode = 'replace') {
      setBusy(`Reading ${files.map(f => f.name).join(', ')}…`);
      try { actions.useImported(await openDeck(files), mode); }
      catch (err) { setBusy(''); alert(err.message || 'That file could not be opened.'); }
    },
    // Download the linked presentation again and replace the slides with it (one Undo brings them back).
    async updateFromLink() {
      const src = deck.source;
      if (!src) return;
      setBusy(`Getting the latest version${src.service ? ` from ${src.service}` : ''}…`);
      try {
        const { importLink } = await import('./lib/convert/links.js');
        const result = await importLink(src.url, { onStatus: setBusy });
        if (result.manual) { setBusy(''); setDialog('import'); return; }
        actions.useImported(result, 'replace');
        setNotice(`Updated from the link. ${result.deck.slides.length} slides. Undo brings back the previous version.`);
      } catch (err) { setBusy(''); alert(err.message); }
    },
    useImported(result, mode) {
      setBusy('');
      if (!result) return;
      const made = result.deck;
      // One change, so Undo brings the previous deck back. Old pictures stay available for that.
      change(d => {
        d.deck.assets = { ...d.deck.assets, ...made.assets };
        if (made.anims) d.deck.anims = { ...d.deck.anims, ...made.anims };   // custom animations come along
        if (made.transitions) d.deck.transitions = { ...d.deck.transitions, ...made.transitions };
        if (mode === 'add') { d.deck.slides.splice(d.cur + 1, 0, ...made.slides); d.cur += 1; }
        else {
          Object.assign(d.deck, { title: made.title, theme: made.theme, slides: made.slides });
          if (result.source) d.deck.source = result.source; else delete d.deck.source;
          d.cur = 0;
        }
        d.sel = null;
      });
      if (mode !== 'add') forgetPath();
      setDialog(null);
      const missing = loadFonts(made);
      const notes = [...result.warnings, missing.length ? `Fonts not on this computer: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}. Close matches are used where available.` : ''].filter(Boolean);
      setNotice(`${mode === 'add' ? 'Added' : 'Opened'} ${made.slides.length} slide${made.slides.length === 1 ? '' : 's'} from ${result.name}.${notes.length ? ` ${notes.join(' ')}` : ''}`);
    },
    save() { saveDeck(deck).catch(err => alert(`Could not save: ${err.message}`)); },
    pdf() { actions.exportAs('pdf'); },
    exportAgain() { actions.exportAs(preferredExport()); },
    async exportAs(kind) {
      try {
        if (kind === 'waypoint') { await saveDeck(deck); setDialog(null); return; }
        if (kind === 'pdf') {
          setDialog(null);
          flushSync(() => setPrinting(true));
          await document.fonts?.ready;
          if (window.desktop?.savePdf) { await window.desktop.savePdf(fileName(deck, 'pdf')); setPrinting(false); }
          else window.print();   // the browser's print dialog: choose "Save as PDF"
          return;
        }
        if (kind === 'png') {
          setBusy('Drawing slides…');
          flushSync(() => setRendering(true));
          const { exportPictures } = await import('./lib/convert/export.js');
          const bytes = await exportPictures(deck, [...document.querySelectorAll('#render .slide')]);
          setRendering(false);
          await saveFile(fileName(deck, 'zip'), bytes, 'application/zip', [{ name: 'Zip', extensions: ['zip'] }]);
        } else {
          setBusy('Building the PowerPoint file…');
          const { exportPptx } = await import('./lib/convert/export.js');
          const bytes = await exportPptx(deck);
          await saveFile(fileName(deck, 'pptx'), bytes, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', [{ name: 'PowerPoint', extensions: ['pptx'] }]);
          if (kind === 'google') setNotice('Saved the .pptx. In Google Drive choose New, File upload, then open it with Google Slides.');
        }
        setBusy('');
        setDialog(null);
      } catch (err) {
        setBusy(''); setRendering(false);
        alert(`Could not export: ${err.message}`);
      }
    },

    // Slides on the other display (or a window of their own), controller here.
    async present() {
      setNotice('');
      await storeDeck(deck).catch(() => {});
      const where = await openAudience(cur);
      if (where === 'retry') setNotice('Second display found. Press Present again to put the slides on it.');
      else if (where) setControl({ at: cur, where });
      else { setNotice('Pop-ups are blocked, so the show is playing in this window.'); setShow({ at: cur, fullscreen: true }); }
    },
    playHere() { setShow({ at: cur, fullscreen: true }); },
  };

  /* ---------- effects ---------- */

  // Save shortly after every change, then tell the presenter window to reload.
  useEffect(() => {
    const t = setTimeout(() => storeDeck(deck).then(() => { setUnsaved(false); send({ type: 'deck' }); }, () => setUnsaved(true)), 250);
    return () => clearTimeout(t);
  }, [deck]);
  useEffect(() => { document.title = `${deck.title || 'Untitled deck'} · Waypoint`; }, [deck.title]);
  useEffect(() => { loadFonts(deck); }, [deck.slides]);
  useEffect(() => subscribe(u => { setUpdate(u); if (u.state === 'ready') setUpdateLater(false); }), []);
  useEffect(() => { if (!show && !control) send({ type: 'state', i: cur }); }, [cur, show, control]);

  // Window-level behaviour. Handlers read the latest render through a ref, so listeners attach once.
  const live = useRef({});
  live.current = { actions, show, control, modal: ai || aiSettings || animEdit || help || dialog, setHelp, cur, sel, el, addEl, addImage, onSlide, editMode, setEditMode, cols, count: deck.slides.length };
  useEffect(() => {
    const onKey = e => {
      const a = live.current;
      if (a.show || a.control || a.modal) return;   // the show, the controller and dialogs handle their own keys
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), arrow = ARROWS[k];
      if (mod && k === 's') { e.preventDefault(); return e.shiftKey ? a.actions.exportAgain() : a.actions.save(); }
      if (mod && k === 'o') { e.preventDefault(); return a.actions.open(); }
      if ((mod && k === 'enter') || k === 'f5') { e.preventDefault(); return a.actions.present(); }
      if (mod && k === 'e') { e.preventDefault(); return a.setEditMode(!a.editMode); }
      if (mod && k === 'g') { e.preventDefault(); return a.actions.generate(); }
      if (typing(e)) return;
      if (e.key === '?') { e.preventDefault(); return a.setHelp(true); }
      if (!a.editMode) {
        // Present mode: move around the light table, Enter presents from the ringed slide.
        const d = { arrowleft: -1, arrowright: 1, arrowup: -a.cols, arrowdown: a.cols }[k];
        if (d) dispatch({ type: 'view', cur: Math.max(0, Math.min(a.count - 1, a.cur + d)) });
        else if (k === 'home') dispatch({ type: 'view', cur: 0 });
        else if (k === 'end') dispatch({ type: 'view', cur: a.count - 1 });
        else if (k === 'enter' || k === ' ') a.actions.present();
        else return;
        return e.preventDefault();
      }
      if (mod) {
        if (k === 'z') e.shiftKey ? a.actions.redo() : a.actions.undo();
        else if (k === 'y') a.actions.redo();
        else if (k === 'd') a.el ? a.actions.dup() : a.actions.dupSlide();
        else if (k === 'm') a.actions.slide();
        else if (k === 'b' && a.el) a.actions.bold();
        else if (k === 'i' && a.el) a.actions.italic();
        else if (k === 'u' && a.el) a.actions.underline();
        else if (k === ']' && a.el) a.actions.order(true);
        else if (k === '[' && a.el) a.actions.order(false);
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
      if (a.show || a.control || a.modal || !a.editMode || typing(e)) return;
      const image = [...e.clipboardData.files].find(f => f.type.startsWith('image/'));
      if (image) a.addImage(image); else if (clip.current) a.addEl(copyOf(clip.current));
    };
    const afterPrint = () => setPrinting(false);
    // Drop a presentation anywhere to open it. Pictures dropped on the slide are handled by the stage.
    const onDragOver = e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) e.preventDefault(); };
    const onDrop = async e => {
      const a = live.current;
      const files = [...e.dataTransfer.files];
      if (!files.length || a.show || a.control) return;
      e.preventDefault();
      if (a.modal) return;
      const decks = files.filter(f => isDeckFile(f.name));
      if (decks.length) a.actions.importFiles(await readDropped(decks), 'replace');
      else if (files.every(f => f.type.startsWith('image/'))) a.actions.importFiles(await readDropped(files), 'add');
    };
    addEventListener('dragover', onDragOver);
    addEventListener('drop', onDrop);
    // Presentations opened from the system: double-click, Open with, the taskbar or Dock icon.
    const stopOpen = onOpenFiles(files => { const decks = files.filter(f => isDeckFile(f.name)); if (decks.length) live.current.actions.importFiles(decks, 'replace'); });
    // An audience window this one did not start (e.g. left over from a reload) ended.
    const stop = listen(m => {
      if (m.type === 'ended' && !live.current.control) dispatch({ type: 'view', cur: m.i });
    });
    addEventListener('keydown', onKey);
    addEventListener('paste', onPaste);
    addEventListener('afterprint', afterPrint);
    return () => {
      stop(); stopOpen(); removeEventListener('keydown', onKey); removeEventListener('paste', onPaste); removeEventListener('afterprint', afterPrint);
      removeEventListener('dragover', onDragOver); removeEventListener('drop', onDrop);
    };
  }, []);

  /* ---------- view ---------- */

  const closeMenu = e => e.currentTarget.closest('details').removeAttribute('open');

  return (
    <>
      <div id="app">
        <header id="bar">
          {editMode ? (
            <>
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
              <button className="aiBtn" onClick={actions.generate} title="Generate slides with AI (Ctrl+G)"><Sparkle /> Generate</button>
              <select aria-label="Theme" value={deck.theme} onChange={e => change(d => { d.deck.theme = e.target.value; })}>
                {Object.entries(THEMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </>
          ) : (
            <>
              <strong id="deckName">{deck.title || 'Untitled deck'}</strong>
              <span className="group modeHint">Present mode · click a slide, then Present</span>
              <ColumnSwitch cols={cols} setCols={setCols} />
            </>
          )}
          {unsaved && <span id="saved">Not saved on this device. Use File, Save file.</span>}
          <span className="grow" />
          {notice && <span id="saved">{notice}</span>}
          <details className="menu">
            <summary>File</summary>
            <div onClick={closeMenu}>
              <button onClick={actions.newDeck}>New deck</button>
              <button onClick={() => setDialog('templates')}>New from template…</button>
              <button onClick={actions.open} title="PowerPoint, Keynote, Google Slides, OpenDocument, PDF, Markdown, pictures (Ctrl+O)">Open or import…</button>
              <button onClick={actions.save} title="Ctrl+S">Save file</button>
              <button onClick={() => setDialog('templates:mine')}>Save as template…</button>
              {deck.source && <button onClick={actions.updateFromLink} title={deck.source.url}>Update from link</button>}
              <hr />
              <button onClick={() => setDialog('export')}>Export…</button>
              <button onClick={actions.exportAgain} title="Ctrl+Shift+S">Export as {EXPORTS[preferredExport()].name}</button>
              <button onClick={() => { flushSync(() => setPrinting(true)); window.print(); }}>Print</button>
              <hr />
              <button onClick={() => actions.settings()}>AI settings</button>
              <button onClick={() => setHelp(true)}>Keyboard shortcuts</button>
              <button onClick={() => setDialog('clicker')}>Clicker setup…</button>
              <button onClick={() => setDialog('install')}>{window.desktop ? 'Pin to taskbar or Dock…' : 'Install as an app…'}</button>
              <button onClick={() => setDialog('uninstall')}>{window.desktop ? 'Uninstall Waypoint…' : 'Remove from this browser…'}</button>
              <button onClick={() => setDialog('about')}>About and updates{['ready', 'manual'].includes(update?.state) ? ' •' : ''}</button>
              <a href="docs/" target="_blank" rel="noopener">Guide</a>
            </div>
          </details>
          <ClickerMenu onSetup={() => setDialog('clicker')} />
          <button onClick={actions.playHere} title="Full-screen show in this window, no controller">Play here</button>
          <button className="primary" onClick={actions.present} title="Slides on the other display (or a new window), controller here (Ctrl+Enter)">Present</button>
          <button
            id="pencil" className={editMode ? 'on' : undefined} aria-pressed={editMode} onClick={() => setEditMode(!editMode)}
            title={editMode ? 'Edit mode is on. Click for present mode (Ctrl+E)' : 'Turn on edit mode (Ctrl+E)'}
          ><Pencil /></button>
        </header>
        {!updateLater && <UpdateBar update={update} onDismiss={() => setUpdateLater(true)} />}

        {!editMode && (
          <div id="table">
            <LightTable deck={deck} active={cur} cols={cols} onPick={i => dispatch({ type: 'view', cur: i })} onOpen={i => { dispatch({ type: 'view', cur: i }); setEditMode(true); }} />
            <p className="tableHint">Click a slide to pick it · Enter or Present starts from it · double-click to edit it</p>
          </div>
        )}
        {editMode && <div id="work">
          <aside id="side">
            <div className="sideBtns">
              <details className="menu layouts">
                <summary title="New slide (Ctrl+M)">+ Slide</summary>
                <div onClick={closeMenu}>
                  {Object.entries(LAYOUTS).map(([kind, name]) => <button key={kind} onClick={() => actions.slide(kind)}>{name}</button>)}
                </div>
              </details>
              <button onClick={actions.dupSlide} title="Duplicate slide">Copy</button>
              <button onClick={actions.delSlide} title="Delete slide">Delete</button>
            </div>
            <div id="strip">
              {deck.slides.map((s, i) => (
                <button
                  key={s.id} className={i === cur ? 'on' : undefined} draggable
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
            {recording && (
              <div className="recordBar" role="status">
                <span>Drag and resize the object to where it should move to.</span>
                <button className="primary" onClick={() => endRecording(true)}>Done</button>
                <button onClick={() => endRecording(false)}>Cancel</button>
              </div>
            )}
            <Stage
              deck={deck} slide={slide} sel={sel} editing={editing} preview={preview}
              onSelect={id => dispatch({ type: 'view', sel: id })}
              onEdit={startEdit} onEditDone={finishEdit} onDropImage={addImage}
              onMove={(id, rect) => onSlide(sl => Object.assign(sl.els.find(x => x.id === id), rect))}
            />
            <textarea id="notes" placeholder="Speaker notes" aria-label="Speaker notes" value={slide.notes} onChange={e => setSlide('notes', e.target.value)} />
          </section>

          <Inspector deck={deck} cur={cur} el={el} setEl={setEl} setSlide={setSlide} actions={actions} />
        </div>}
      </div>

      {control && (
        <Presenter
          deck={deck} start={control.at} where={control.where}
          onEnd={(i, fromAudience) => {
            if (!fromAudience) { send({ type: 'end' }); closeAudience(); }
            setControl(null);
            dispatch({ type: 'view', cur: i });
          }}
        />
      )}
      {show && <Show deck={deck} start={show.at} fullscreen={show.fullscreen} enter={show.enter} onExit={i => { setShow(null); dispatch({ type: 'view', cur: i }); }} />}
      <Suspense fallback={null}>
      {ai && (
        <AiGenerate
          deck={deck} cur={cur} onClose={() => setAi(false)}
          onSettings={then => actions.settings(then)}
          onInsert={actions.insertSlides}
        />
      )}
      {transEdit && <TransitionEditor start={transEdit.start} deck={deck} a={deck.slides[cur - 1] || slide} b={slide} onSave={actions.saveTransition} onClose={() => setTransEdit(null)} />}
      {animEdit && <AnimEditor start={animEdit.start} kind={animEdit.target?.kind} sample={el ? (el.type === 'text' && firstLine(el.text)) || 'Your object' : ''} onSave={actions.saveAnim} onClose={() => setAnimEdit(null)} />}
      {aiSettings && <AiSettings onClose={s => { const then = aiSettings; setAiSettings(null); then(s); }} />}
      </Suspense>
      {help && (
        <div className="helpSheet" role="dialog" aria-label="Keyboard shortcuts" onClick={() => setHelp(false)} onKeyDown={e => e.key === 'Escape' && setHelp(false)}>
          <div onClick={e => e.stopPropagation()}>
            <header><h2>Keyboard shortcuts</h2><button className="x" autoFocus onClick={() => setHelp(false)} aria-label="Close">×</button></header>
            <div className="helpCols">
              {SHORTCUTS.map(([group, keys]) => (
                <section key={group}><h3>{group}</h3><dl>{keys.map(([k, what]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{what}</dd></div>)}</dl></section>
              ))}
            </div>
          </div>
        </div>
      )}
      {dialog === 'import' && <ImportDialog busy={busy} onClose={() => { setDialog(null); setBusy(''); }} onFiles={actions.importFiles} onResult={actions.useImported} />}
      {dialog === 'export' && <ExportDialog busy={busy} onClose={() => { setDialog(null); setBusy(''); }} onExport={actions.exportAs} />}
      <Suspense fallback={null}>{dialog?.startsWith('templates') && <TemplatesDialog deck={deck} start={dialog === 'templates:mine' ? 'mine' : 'gallery'} onUse={actions.useImported} onClose={() => setDialog(null)} />}</Suspense>
      {dialog === 'clicker' && <ClickerDialog onClose={() => setDialog(null)} />}
      {dialog === 'install' && <InstallDialog onClose={() => setDialog(null)} />}
      {dialog === 'uninstall' && <UninstallDialog onClose={() => setDialog(null)} />}
      {dialog === 'about' && <AboutDialog update={update} onClose={() => setDialog(null)} />}
      {busy && !dialog && <div className="busy" role="status"><span className="spinner small" /> {busy}</div>}
      {rendering && <div id="render" aria-hidden="true">{deck.slides.map(s => <div className="page" key={s.id}><SlideView deck={deck} slide={s} /></div>)}</div>}
      {printing && <div id="print">{deck.slides.map(s => <div className="page" key={s.id}><SlideView deck={deck} slide={s} /></div>)}</div>}
    </>
  );
}
