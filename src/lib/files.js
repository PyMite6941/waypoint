// Reading and writing files. On the desktop this goes through native dialogs
// (window.desktop, see desktop/preload.cjs); in a browser it uploads and downloads.
// Other formats are converted in convert/import.js and convert/export.js.

import { IMPORT_ACCEPT, importFiles } from './convert/import.js';

const desktop = window.desktop;
const FILTERS = [{ name: 'Waypoint deck', extensions: ['json'] }];
// A function, not a constant: convert/import.js imports this file too, so IMPORT_ACCEPT
// may not exist yet while this module first runs.
const openFilters = () => [
  { name: 'Presentations', extensions: IMPORT_ACCEPT.split(',').map(e => e.slice(1)) },
  { name: 'All files', extensions: ['*'] },
];
let lastPath;   // desktop only: where the open deck was last saved

function pickUpload(accept, multiple = false) {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple });
    input.onchange = () => resolve(multiple ? [...input.files] : input.files[0] || null);
    input.oncancel = () => resolve(multiple ? [] : null);
    input.click();
  });
}

export const forgetPath = () => { lastPath = undefined; };
export const fileName = (deck, ext) => `${deck.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'deck'}.${ext}`;

// Ask for one or more files of any supported kind. Resolves to [{ name, bytes, path? }] (empty if cancelled).
export async function pickFiles() {
  if (desktop) {
    const f = await desktop.open(openFilters());
    return f ? [{ name: f.name, bytes: f.data, path: f.path }] : [];
  }
  const files = await pickUpload(IMPORT_ACCEPT, true);
  return Promise.all(files.map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}
export const readDropped = list => Promise.all([...list].map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));

// Open any supported file as a deck. Resolves to { deck, warnings, name } or null if cancelled.
// A Waypoint file opened on the desktop is saved back to the same place by Save.
export async function openDeck(files) {
  files ??= await pickFiles();
  if (!files.length) return null;
  const result = await importFiles(files);
  lastPath = files.length === 1 && /\.json$/i.test(files[0].name) ? files[0].path : undefined;
  return { ...result, name: files.map(f => f.name).join(', ') };
}

// Save bytes or text under a name: a save dialog on the desktop, a download in a browser.
export async function saveFile(name, data, type, filters) {
  if (desktop) return desktop.save({ name, data, filters });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([data], { type })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return { name };
}

export async function saveDeck(deck) {
  // Only keep images that are still on a slide.
  const used = new Set(deck.slides.flatMap(s => [s.bgImg, ...s.els.map(e => e.src)]));
  const assets = Object.fromEntries(Object.entries(deck.assets).filter(([id]) => used.has(id)));
  const text = JSON.stringify({ ...deck, assets });
  const name = fileName(deck, 'waypoint.json');
  if (desktop) {
    const saved = await desktop.save({ path: lastPath, name, data: text, filters: FILTERS });
    if (saved) lastPath = saved.path;
    return saved;
  }
  return saveFile(name, text, 'application/json');
}

export const pickImage = () => pickUpload('image/*');

// Read an image and shrink large ones, so decks stay small enough to store and share.
// Resolves to { src, w, h }.
export function readImage(file) {
  return new Promise((ok, fail) => {
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = () => {
      const img = new Image();
      img.onerror = fail;
      img.onload = () => {
        const w = img.width || 400, h = img.height || 300, k = Math.min(1, 1920 / Math.max(w, h));
        let src = reader.result;
        if (!/svg|gif/.test(file.type) && (k < 1 || file.size > 400e3)) {
          const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(w * k), height: Math.round(h * k) });
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          src = canvas.toDataURL('image/webp', 0.85);
        }
        ok({ src, w, h });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
