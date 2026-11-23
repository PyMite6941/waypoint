// Templates: decks to start from.
//
//   Gallery        Waypoint's own templates. The list comes from the website, so new ones appear
//                  without an update; a copy ships with the app for when it is offline.
//   More galleries other template lists (feeds) people add by link, from anyone who publishes one
//   My templates   decks saved on this computer with "Save as template"
//   From a link    any Google Slides, PowerPoint, OneDrive, Dropbox… presentation link
//
// A feed is JSON:
//   { "waypoint": "templates", "v": 1, "name": "…", "templates": [
//       { "id": "pitch", "name": "…", "description": "…", "author": "…", "license": "…",
//         "tags": ["…"], "file": "pitch.json" | "https://docs.google.com/presentation/d/…" } ] }
// `file` is relative to the feed or an https link: a Waypoint deck, or any presentation the
// link importer understands. Everything from a feed is treated as untrusted: only https links,
// limited sizes, plain text only, and decks go through cleanDeck like any opened file.
import { cleanDeck, uid } from './deck.js';
import { kvDelete, kvGet, kvSet } from './store.js';

export const OFFICIAL_FEEDS = [
  'https://pymite6941.github.io/waypoint/templates/index.json',
  'https://raw.githubusercontent.com/PyMite6941/waypoint/main/public/templates/index.json',
];
const BUNDLED_FEED = 'templates/index.json';   // shipped with the app
const MAX_FEED = 1e6, MAX_ENTRIES = 200;

const text = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const httpsUrl = (v, base) => {
  try {
    const u = new URL(String(v), base);
    if (u.protocol === 'https:' || (base && new URL(base, location.href).origin === u.origin)) return u.href;
  } catch {}
  return null;
};

/** A feed's templates, cleaned: [{ id, name, description, author, license, tags, file, feed }]. */
export function cleanFeed(data, feedUrl) {
  if (!data || data.waypoint !== 'templates' || !Array.isArray(data.templates)) throw new Error('That link is not a template gallery.');
  const base = new URL(feedUrl, location.href).href, seen = new Set(), list = [];
  for (const t of data.templates.slice(0, MAX_ENTRIES)) {
    const file = t && httpsUrl(t.file, base);
    const id = text(t?.id, 40) || file;
    if (!file || seen.has(id)) continue;
    seen.add(id);
    list.push({
      id, file, feed: base,
      name: text(t.name, 80) || 'Untitled template', description: text(t.description, 300),
      author: text(t.author, 80), license: text(t.license, 80),
      tags: Array.isArray(t.tags) ? t.tags.slice(0, 8).map(x => text(x, 24)).filter(Boolean) : [],
    });
  }
  return { name: text(data.name, 80) || new URL(base).host, templates: list };
}

async function getJson(url) {
  let bytes;
  if (/^https:/.test(url)) {
    const { download } = await import('./convert/links.js');
    const r = await download(url);
    if (r.status && r.status >= 400) throw new Error(r.status === 404 ? 'The gallery was not found at that link.' : `The gallery could not be loaded (error ${r.status}).`);
    bytes = r.bytes;
  } else {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Could not load ${url}`);
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  if (bytes.length > MAX_FEED) throw new Error('That gallery list is too large.');
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('That link is not a template gallery.'); }
}
const resolve = url => new URL(url, location.href).href;

/** Waypoint's gallery: online if it can be reached, else the copy in the app. { name, templates, online } */
export async function officialGallery() {
  for (const url of OFFICIAL_FEEDS) {
    try { return { ...cleanFeed(await getJson(url), url), online: true }; } catch {}
  }
  return { ...cleanFeed(await getJson(BUNDLED_FEED), resolve(BUNDLED_FEED)), online: false };
}

/** Another gallery, by its link. */
export async function loadFeed(url) {
  if (!/^https:\/\//i.test(url)) throw new Error('A gallery link starts with https://');
  return cleanFeed(await getJson(url), url);
}

// The galleries people added (links only), on this computer.
const FEEDS_KEY = 'waypoint.templateFeeds';
export function savedFeeds() {
  try { return (JSON.parse(localStorage.getItem(FEEDS_KEY) || '[]') || []).filter(u => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 20); } catch { return []; }
}
export function setSavedFeeds(list) {
  try { localStorage.setItem(FEEDS_KEY, JSON.stringify([...new Set(list)].slice(0, 20))); } catch {}
}

/** Downloads a template from a gallery or a link: { deck, name }. */
export async function fetchTemplate(fileOrLink, onStatus) {
  if (!/^https:/i.test(fileOrLink)) {   // a template shipped with the app
    const r = await fetch(fileOrLink);
    if (!r.ok) throw new Error('That template is missing from this copy of Waypoint.');
    const { openDeck } = await import('./files.js');
    const name = decodeURIComponent(new URL(fileOrLink, location.href).pathname.split('/').pop());
    return openDeck([{ name, bytes: new Uint8Array(await r.arrayBuffer()) }]);
  }
  const { importLink } = await import('./convert/links.js');
  const r = await importLink(fileOrLink, { onStatus });
  if (r.manual) throw Object.assign(new Error(r.help || 'This site would not let the browser download the template.'), { manual: r.manual });
  return { deck: r.deck, name: r.name };
}

/* ---------- My templates (this computer) ---------- */

// Kept in IndexedDB next to the open deck: an index of { id, name, description, at, preview }
// (preview: the first slide with only its own pictures) and each deck under its own key.
const INDEX = 'templates';
export async function myTemplates() { return (await kvGet(INDEX)) || []; }
export async function myTemplate(id) { const d = await kvGet(`template:${id}`); return d ? cleanDeck(d) : null; }
function previewOf(deck) {
  const first = deck.slides[0], used = new Set([first.bgImg, ...first.els.map(e => e.src)].filter(Boolean));
  return { ...deck, slides: [first], assets: Object.fromEntries(Object.entries(deck.assets).filter(([k]) => used.has(k))) };
}
export async function saveMyTemplate(deck, { name, description }) {
  const id = uid(), clean = cleanDeck(deck);
  const entry = { id, name: text(name, 80) || clean.title, description: text(description, 300), at: Date.now(), preview: previewOf(clean) };
  await kvSet([[`template:${id}`, clean], [INDEX, [entry, ...(await myTemplates())]]]);
  return entry;
}
export async function deleteMyTemplate(id) {
  await kvSet([[INDEX, (await myTemplates()).filter(t => t.id !== id)]]);
  await kvDelete([`template:${id}`]);
}

/**
 * A template's deck ready to use: new ids for every slide and object (so adding the same
 * template twice cannot clash), with links between its slides kept.
 */
export function freshCopy(deck) {
  const d = structuredClone(deck), ids = new Map();
  for (const s of d.slides) { ids.set(s.id, uid()); s.id = ids.get(s.id); for (const e of s.els) e.id = uid(); }
  for (const s of d.slides) {
    s.next = s.next.map(n => ids.get(n)).filter(Boolean);
    for (const e of s.els) if (e.link) e.link = ids.get(e.link);
    for (const e of s.els) if (!e.link) delete e.link;
  }
  return d;
}
