// Where the open deck is kept between sessions: one key-value store in IndexedDB.
// Decks with images outgrow localStorage quickly.
import { cleanDeck } from './deck.js';

let ready, closed = false;
const open = () => ready ??= new Promise((ok, fail) => {
  const request = indexedDB.open('waypoint', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('kv');
  request.onsuccess = () => ok(request.result);
  request.onerror = () => fail(request.error);
});

async function get(key) {
  const db = await open();
  return new Promise((ok, fail) => {
    const request = db.transaction('kv').objectStore('kv').get(key);
    request.onsuccess = () => ok(request.result);
    request.onerror = () => fail(request.error);
  });
}

// Writes several keys in one transaction, so a reader never sees half of a save.
export const kvGet = key => get(key);
export const kvSet = entries => set(entries);
export async function kvDelete(keys) {
  const db = await open();
  return new Promise((ok, fail) => {
    const tx = db.transaction('kv', 'readwrite');
    for (const key of keys) tx.objectStore('kv').delete(key);
    tx.oncomplete = () => ok();
    tx.onerror = tx.onabort = () => fail(tx.error);
  });
}

/** Stops saving and lets go of the database (before it is deleted, see UninstallDialog). */
export async function closeStore() {
  closed = true;
  if (ready) (await ready.catch(() => null))?.close();
}

async function set(entries) {
  if (closed) return;
  const db = await open();
  return new Promise((ok, fail) => {
    const tx = db.transaction('kv', 'readwrite');
    for (const [key, value] of entries) tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => ok();
    tx.onerror = tx.onabort = () => fail(tx.error);
  });
}

// The deck is saved after every change, but its pictures (often most of its size) are kept
// under their own key and written only when they changed. Edits keep the same assets object
// until a picture is added, so comparing the object is enough.
let savedAssets = null;
export async function storeDeck(deck) {
  const { assets, ...rest } = deck;
  const entries = [['deck', rest]];
  if (assets !== savedAssets) entries.push(['assets', assets || {}]);
  await set(entries);
  savedAssets = assets;
}
export async function loadDeck() {
  try {
    const deck = await get('deck');
    if (deck && !deck.assets) deck.assets = (await get('assets')) || {};   // older saves kept pictures inside the deck
    return cleanDeck(deck);
  } catch { return null; }
}

// Messages between the editor/show window and the presenter window:
//   show -> presenter   { type: 'state', i }     current slide
//   editor -> presenter { type: 'deck' }         deck was saved, reload it
//   presenter -> show   { type: 'hello' } | { type: 'goto', i } | { type: 'step', d } | { type: 'back' }
export const channel = window.BroadcastChannel ? new BroadcastChannel('waypoint') : null;
export const send = message => channel?.postMessage(message);
export function listen(handler) {
  const fn = e => handler(e.data);
  channel?.addEventListener('message', fn);
  return () => channel?.removeEventListener('message', fn);
}
