import { useEffect, useState } from 'react';
import { saveFile } from '../lib/files.js';
import {
  deleteMyTemplate, fetchTemplate, freshCopy, loadFeed, myTemplate, myTemplates, officialGallery,
  saveMyTemplate, savedFeeds, setSavedFeeds,
} from '../lib/templates.js';
import Modal from './Modal.jsx';
import { Thumb } from './SlideView.jsx';

const TABS = { gallery: 'Gallery', mine: 'My templates', link: 'From a link', feeds: 'More galleries' };
// Gallery previews: each Waypoint template is downloaded once per session (they are small).
const previews = new Map();
const previewOf = file => {
  if (!/\.json(\?|$)/i.test(file)) return Promise.resolve(null);
  if (!previews.has(file)) previews.set(file, fetchTemplate(file).then(r => r.deck, () => null));
  return previews.get(file);
};

// Start a deck from a template, add a template's slides, or save this deck as a template.
// onUse({ deck, name }, mode): mode 'replace' starts a new deck, 'add' puts the slides after this one.
export default function TemplatesDialog({ deck, start = 'gallery', onUse, onClose }) {
  const [tab, setTab] = useState(start);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function use(get, mode) {
    setError('');
    try {
      const r = await get();
      if (!r?.deck) throw new Error('That template could not be opened.');
      onUse({ ...r, deck: freshCopy(r.deck) }, mode);
    } catch (err) {
      setBusy('');
      if (err.manual) window.open(err.manual, '_blank', 'noopener');
      setError(err.message || 'That template could not be opened.');
    }
  }
  const fromFile = (file, name) => mode => { setBusy(`Getting “${name}”…`); return use(() => fetchTemplate(file, setBusy), mode); };

  return (
    <Modal title="Templates" onClose={onClose} wide>
      <nav className="tabs" role="tablist">
        {Object.entries(TABS).map(([k, name]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setError(''); }}>{name}</button>)}
      </nav>
      <div className="form templates">
        {tab === 'gallery' && <Gallery load={officialGallery} fromFile={fromFile} busy={busy} />}
        {tab === 'mine' && <Mine deck={deck} use={use} setBusy={setBusy} setError={setError} busy={busy} />}
        {tab === 'link' && <FromLink fromFile={fromFile} busy={busy} />}
        {tab === 'feeds' && <Feeds fromFile={fromFile} busy={busy} />}
        {busy && <p className="status" role="status">{busy}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

function useAsync(load, deps) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    setState({ loading: true });
    load().then(value => live && setState({ value }), err => live && setState({ error: err.message || String(err) }));
    return () => { live = false; };
  }, deps);   // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

function Gallery({ load, fromFile, busy }) {
  const g = useAsync(load, [load]);
  if (g.loading) return <p className="dim">Loading templates…</p>;
  if (g.error) return <p className="error">{g.error}</p>;
  return (
    <>
      {!g.value.online && g.value.templates && <p className="dim">Offline: showing the templates that come with Waypoint.</p>}
      <Cards list={g.value.templates} fromFile={fromFile} busy={busy} />
    </>
  );
}

function Cards({ list, fromFile, busy }) {
  if (!list.length) return <p className="dim">No templates here yet.</p>;
  return (
    <ul className="tplGrid">
      {list.map(t => <Card key={t.id} t={t} actions={fromFile(t.file, t.name)} busy={busy} />)}
    </ul>
  );
}

function Card({ t, actions, busy }) {
  const [preview, setPreview] = useState(t.preview || null);
  useEffect(() => { if (!t.preview && t.file) { let live = true; previewOf(t.file).then(d => live && setPreview(d)); return () => { live = false; }; } }, [t.file, t.preview]);
  const host = t.file && /^https:/.test(t.file) && !/\.json(\?|$)/i.test(t.file) ? new URL(t.file).host.replace(/^www\./, '') : '';
  return (
    <li className="tplCard">
      <div className="tplThumb">{preview ? <Thumb deck={preview} slide={preview.slides[0]} width={224} /> : <span>{host || 'Preview not available'}</span>}</div>
      <b>{t.name}</b>
      {t.description && <span className="dim">{t.description}</span>}
      {(t.author || t.license) && <span className="dim small">{[t.author && `by ${t.author}`, t.license].filter(Boolean).join(' · ')}</span>}
      <div className="row">
        <button className="primary" disabled={Boolean(busy)} onClick={() => actions('replace')}>New deck</button>
        <button disabled={Boolean(busy)} onClick={() => actions('add')} title="Add its slides after the current slide">Add slides</button>
        {t.extra}
      </div>
    </li>
  );
}

function Mine({ deck, use, setBusy, setError, busy }) {
  const [list, setList] = useState(null);
  const [name, setName] = useState(deck.title);
  const [description, setDescription] = useState('');
  const [saved, setSaved] = useState('');
  const refresh = () => myTemplates().then(setList, err => setError(err.message));
  useEffect(() => { refresh(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setError(''); setSaved('');
    try { const t = await saveMyTemplate(deck, { name, description }); setSaved(`Saved “${t.name}” to My templates.`); refresh(); }
    catch (err) { setError(err?.name === 'QuotaExceededError' ? 'There is no room left to save templates in this browser.' : err.message); }
  }
  async function exportOne(t) {
    const d = await myTemplate(t.id);
    if (d) await saveFile(`${t.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'template'}.waypoint.json`, JSON.stringify({ ...d, template: { name: t.name, description: t.description } }), 'application/json', [{ name: 'Waypoint deck', extensions: ['json'] }]);
  }
  const fromMine = t => mode => { setBusy(`Opening “${t.name}”…`); return use(async () => ({ deck: await myTemplate(t.id), name: t.name }), mode); };

  return (
    <>
      <fieldset className="tplSave">
        <legend>Save this deck as a template</legend>
        <label>Name<input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
        <label>Description <span className="dim">(optional)</span><input value={description} maxLength={300} onChange={e => setDescription(e.target.value)} /></label>
        <div className="row"><button className="primary" onClick={save}>Save as template</button>{saved && <span className="status">{saved}</span>}</div>
        <p className="dim">Templates keep the slides, pictures, colours and custom animations, and stay on this computer. Export one to share it, or to publish it in a gallery.</p>
      </fieldset>
      {list === null ? <p className="dim">Loading…</p>
        : !list.length ? <p className="dim">No templates saved yet.</p>
        : <ul className="tplGrid">{list.map(t => (
            <Card key={t.id} t={{ ...t, extra: <>
              <button onClick={() => exportOne(t)}>Export…</button>
              <button onClick={async () => { await deleteMyTemplate(t.id); refresh(); }}>Delete</button>
            </> }} actions={fromMine(t)} busy={busy} />
          ))}</ul>}
    </>
  );
}

function FromLink({ fromFile, busy }) {
  const [link, setLink] = useState('');
  const ok = /^https:\/\/\S+$/i.test(link.trim());
  const go = fromFile(link.trim(), 'the template');
  return (
    <>
      <label>Link to a template
        <input type="url" placeholder="Google Slides, PowerPoint, OneDrive, Dropbox or Waypoint template link" value={link} onChange={e => setLink(e.target.value)} />
      </label>
      <p className="dim">Template sites often offer Google Slides or PowerPoint versions: copy that link (or the download link) and paste it here. For Google Slides, the template must be shared so anyone with the link can view it.</p>
      <div className="row">
        <button className="primary" disabled={!ok || Boolean(busy)} onClick={() => go('replace')}>New deck from link</button>
        <button disabled={!ok || Boolean(busy)} onClick={() => go('add')}>Add its slides</button>
      </div>
    </>
  );
}

function Feeds({ fromFile, busy }) {
  const [feeds, setFeeds] = useState(savedFeeds);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  async function add() {
    setError('');
    const url = link.trim();
    setAdding(true);
    try { await loadFeed(url); const next = [...feeds.filter(f => f !== url), url]; setSavedFeeds(next); setFeeds(next); setLink(''); }
    catch (err) { setError(err.message); }
    finally { setAdding(false); }
  }
  const remove = url => { const next = feeds.filter(f => f !== url); setSavedFeeds(next); setFeeds(next); };
  return (
    <>
      <label>Add a gallery
        <div className="row">
          <input type="url" placeholder="https://… link to a template gallery (index.json)" value={link} onChange={e => setLink(e.target.value)} />
          <button disabled={!/^https:\/\/\S+$/i.test(link.trim()) || adding} onClick={add}>{adding ? 'Checking…' : 'Add'}</button>
        </div>
      </label>
      <p className="dim">A gallery is a list of templates anyone can publish (a team, a school, a designer). See the Waypoint docs for the format. Only add galleries from people you trust; their templates open like any other file.</p>
      {error && <p className="error">{error}</p>}
      {feeds.length === 0 && <p className="dim">No other galleries added.</p>}
      {feeds.map(url => <FeedSection key={url} url={url} fromFile={fromFile} busy={busy} onRemove={() => remove(url)} />)}
    </>
  );
}

function FeedSection({ url, fromFile, busy, onRemove }) {
  const g = useAsync(() => loadFeed(url), [url]);
  return (
    <section className="tplFeed">
      <h3><span className="grow">{g.value?.name || new URL(url).host}</span><button className="link" onClick={onRemove}>Remove</button></h3>
      {g.loading ? <p className="dim">Loading…</p> : g.error ? <p className="error">{g.error}</p> : <Cards list={g.value.templates} fromFile={fromFile} busy={busy} />}
    </section>
  );
}
