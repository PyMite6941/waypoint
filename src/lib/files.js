// Reading and writing files. On the desktop this goes through native dialogs
// (window.desktop, see desktop/preload.cjs); in a browser it uploads and downloads.
// To support another format, convert it to or from a deck here.
import { cleanDeck } from './deck.js';

const desktop = window.desktop;
const FILTERS = [{ name: 'Waypoint deck', extensions: ['json'] }];
let lastPath;   // desktop only: where the open deck was last saved

function pickUpload(accept) {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    input.onchange = () => resolve(input.files[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export const forgetPath = () => { lastPath = undefined; };

// Resolves to a deck, or null if the user cancelled. Throws if the file is not a deck.
export async function openDeck() {
  const file = desktop ? await desktop.open(FILTERS) : await pickUpload('.json,application/json');
  if (!file) return null;
  const deck = cleanDeck(JSON.parse(desktop ? file.text : await file.text()));
  lastPath = file.path;
  return deck;
}

export async function saveDeck(deck) {
  // Only keep images that are still on a slide.
  const used = new Set(deck.slides.flatMap(s => s.els.map(e => e.src)));
  const assets = Object.fromEntries(Object.entries(deck.assets).filter(([id]) => used.has(id)));
  const text = JSON.stringify({ ...deck, assets });
  const name = `${deck.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'deck'}.waypoint.json`;
  if (desktop) {
    const saved = await desktop.save({ path: lastPath, name, text, filters: FILTERS });
    if (saved) lastPath = saved.path;
    return;
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
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
