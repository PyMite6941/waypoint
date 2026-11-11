// Where the open deck is kept between sessions: one key-value store in IndexedDB.
// Decks with images outgrow localStorage quickly.
import { cleanDeck } from './deck.js';

let ready;
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

async function set(key, value) {
  const db = await open();
  return new Promise((ok, fail) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => ok();
    tx.onerror = tx.onabort = () => fail(tx.error);
  });
}

export const storeDeck = deck => set('deck', deck);
export async function loadDeck() {
  try { return cleanDeck(await get('deck')); } catch { return null; }
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
