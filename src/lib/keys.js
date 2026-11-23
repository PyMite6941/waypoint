// API keys live in a .env file on this computer, never in the deck or the browser's storage:
//   desktop app      Waypoint's settings folder (the project folder when run from source)
//   npm run dev      the project folder, through the dev server (localhost only)
//   web, Chrome/Edge a .env file the person picks once; Waypoint reads and writes it
//   web, elsewhere   a .env file opened each session; changes are downloaded as a new file
// Several keys per provider are allowed (ANTHROPIC_API_KEY, ANTHROPIC_API_KEY_WORK, ...).
// How much each key has been used is counted here, on this device, and kept in localStorage
// (counts only, never the key): providers do not report usage to an ordinary API key.
import { ENV_NAMES, keyName, parseEnv, updateEnv, varName } from './envfile.js';

let state = { loaded: false, backend: null, path: '', text: '', needs: null, dirty: false, error: '' };
const subs = new Set();
const set = patch => { state = { ...state, ...patch }; subs.forEach(fn => fn(state)); };
/** fn(state) on every change. Returns an unsubscribe function. */
export const onKeys = fn => { subs.add(fn); return () => subs.delete(fn); };
export const keyState = () => state;
/** Whether keys can be saved without the person downloading a file. */
export const writable = () => ['desktop', 'dev', 'file'].includes(state.backend) && !state.needs;

/* ---------- where the file is ---------- */

const DEV_API = '/__waypoint/env';
const H = { 'X-Waypoint': '1' };
async function devRead() {
  const r = await fetch(DEV_API, { headers: H, cache: 'no-store' });
  if (!r.ok) throw new Error(`The dev server would not read .env (${r.status}).`);
  return r.json();
}
async function devWrite(text) {
  const r = await fetch(DEV_API, { method: 'PUT', headers: { ...H, 'Content-Type': 'text/plain' }, body: text });
  if (!r.ok) throw new Error(`The dev server would not save .env (${r.status}).`);
}

// The chosen file's handle, remembered between visits (Chrome and Edge only).
const idb = () => new Promise((resolve, reject) => {
  const q = indexedDB.open('waypoint-keys', 1);
  q.onupgradeneeded = () => q.result.createObjectStore('handles');
  q.onsuccess = () => resolve(q.result);
  q.onerror = () => reject(q.error);
});
async function remember(handle) {
  const db = await idb();
  await new Promise((res, rej) => { const t = db.transaction('handles', 'readwrite'); handle ? t.objectStore('handles').put(handle, 'env') : t.objectStore('handles').delete('env'); t.oncomplete = res; t.onerror = () => rej(t.error); });
}
async function recall() {
  const db = await idb();
  return new Promise((res, rej) => { const q = db.transaction('handles').objectStore('handles').get('env'); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); });
}
let handle = null;
export const canPickFile = () => typeof window !== 'undefined' && 'showOpenFilePicker' in window;
const readHandle = async () => set({ backend: 'file', path: handle.name, text: await (await handle.getFile()).text(), needs: null, error: '' });

/** Loads the keys once. Safe to call often. */
export async function openKeys() {
  if (state.loaded) return state;
  try {
    if (window.desktop?.env) { const r = await window.desktop.env.read(); set({ backend: 'desktop', path: r.path, text: r.text }); }
    else if (import.meta.env.DEV) { const r = await devRead(); set({ backend: 'dev', path: r.path, text: r.text }); }
    else if (canPickFile()) {
      handle = await recall().catch(() => null);
      if (!handle) set({ needs: 'connect' });
      else if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') await readHandle();
      else set({ backend: 'file', path: handle.name, needs: 'permission' });
    } else set({ needs: 'connect' });
  } catch (err) { set({ error: err.message }); }
  set({ loaded: true });
  await moveBrowserKeys();
  return state;
}

/** Web: pick an existing .env file (create = false) or make a new one. Needs a click. */
export async function connectFile(create = false) {
  handle = create
    ? await window.showSaveFilePicker({ suggestedName: 'waypoint.env', types: [{ description: '.env file', accept: { 'text/plain': ['.env'] } }] })
    : (await window.showOpenFilePicker({ multiple: false }))[0];
  if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Waypoint needs permission to read and save that file.');
  await remember(handle).catch(() => {});
  await readHandle();
  await moveBrowserKeys();
}
/** Web: allow access again to the file picked on an earlier visit. Needs a click. */
export async function reconnect() {
  if (!handle) return connectFile();
  if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Waypoint needs permission to read and save that file.');
  await readHandle();
  await moveBrowserKeys();
}
/** Web without file access (Firefox, Safari): the text of a .env file the person opened. */
export function useEnvText(text, name) { handle = null; set({ backend: 'session', path: name || '.env', text, needs: null, dirty: false, error: '' }); }
/** Stop using the remembered file (web). The file itself is left alone. */
export async function forgetFile() { handle = null; await remember(null).catch(() => {}); set({ backend: null, path: '', text: '', needs: 'connect', dirty: false }); }
export const showFile = () => window.desktop?.env?.show();
/** The file as it stands, for downloading when it cannot be saved in place. */
export const envText = () => state.text;

async function write(text) {
  if (state.backend === 'desktop') await window.desktop.env.write(text);
  else if (state.backend === 'dev') await devWrite(text);
  else if (state.backend === 'file' && !state.needs) { const w = await handle.createWritable(); await w.write(text); await w.close(); }
  else if (state.backend !== 'session') throw new Error('Choose a .env file first.');
  set({ text, dirty: state.backend === 'session', error: '' });
}

/* ---------- the keys ---------- */

function managed() {
  const out = new Map();
  for (const [name, value] of parseEnv(state.text)) if (keyName(name) && value) out.set(name, value);
  return out;
}

/** A provider's keys: [{ name, label, key }] in file order. */
export function keysFor(provider) {
  const list = [];
  for (const [name, key] of managed()) { const k = keyName(name); if (k.provider === provider) list.push({ name, label: k.label, key }); }
  return list;
}

/** Adds or replaces the key with this label. Returns its variable name. */
export async function saveKey(provider, label, key) {
  const name = varName(provider, label), keys = managed();
  keys.set(name, key.trim());
  await write(updateEnv(state.text, keys));
  return name;
}
export async function removeKey(name) {
  const keys = managed();
  keys.delete(name);
  await write(updateEnv(state.text, keys));
}

// Keys saved by earlier versions in localStorage go into the .env file once it can be written.
async function moveBrowserKeys() {
  if (!writable()) return;
  let s;
  try { s = JSON.parse(localStorage.getItem('waypoint.ai')); } catch { return; }
  const old = Object.entries(s?.per || {}).filter(([id, p]) => p?.key && ENV_NAMES[id]);
  if (!old.length) return;
  const keys = managed();
  for (const [id, p] of old) {
    if ([...keys.values()].includes(p.key)) continue;
    keys.set(keys.has(ENV_NAMES[id]) ? varName(id, 'browser') : ENV_NAMES[id], p.key);
  }
  try {
    await write(updateEnv(state.text, keys));
    for (const [, p] of old) delete p.key;
    localStorage.setItem('waypoint.ai', JSON.stringify(s));
  } catch (err) { set({ error: err.message }); }
}

/* ---------- usage, counted on this device ---------- */

const USAGE = 'waypoint.ai.usage';
const month = () => new Date().toISOString().slice(0, 7);
// A fingerprint, so a different key saved under the same name starts from zero. Not reversible.
const fp = key => { let h = 2166136261; for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const readAll = () => { try { return JSON.parse(localStorage.getItem(USAGE)) || {}; } catch { return {}; } };
const fresh = key => ({ fp: fp(key), month: month(), input: 0, output: 0, requests: 0, total: { input: 0, output: 0, requests: 0 }, lastUsed: 0, limitedUntil: 0, refused: false, note: '' });

/** This month's use of a key: { input, output, requests, total, lastUsed, limitedUntil, refused, note }. */
export function usageOf(provider, k) {
  const u = readAll()[`${provider}:${k.name}`];
  if (!u || u.fp !== fp(k.key)) return fresh(k.key);
  return u.month === month() ? u : { ...u, month: month(), input: 0, output: 0, requests: 0 };
}
function save(provider, k, u) {
  const all = readAll();
  all[`${provider}:${k.name}`] = u;
  try { localStorage.setItem(USAGE, JSON.stringify(all)); } catch { /* storage blocked: counts last for this visit */ }
}
export function recordUsage(provider, k, { input = 0, output = 0 } = {}) {
  const u = usageOf(provider, k);
  save(provider, k, {
    ...u, input: u.input + input, output: u.output + output, requests: u.requests + 1,
    total: { input: u.total.input + input, output: u.total.output + output, requests: u.total.requests + 1 },
    lastUsed: Date.now(), limitedUntil: 0, refused: false, note: '',
  });
}
/** Notes a problem with a key: { limitedUntil, refused, note }. */
export function markKey(provider, k, patch) { save(provider, k, { ...usageOf(provider, k), ...patch }); }
export function resetUsage(provider, k) { save(provider, k, { ...fresh(k.key), total: usageOf(provider, k).total }); }
