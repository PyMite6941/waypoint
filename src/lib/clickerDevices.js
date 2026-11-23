// Which clicker the presenter uses, for the Clicker menu.
//   desktop app       the Bluetooth devices paired with this computer, from the operating system
//   Chrome and Edge   input devices the person has allowed (WebHID); "Find a clicker" asks for one
//   other browsers    no way to list devices; any clicker still works
// A clicker is a small keyboard, so its keys reach the show whichever device is picked.
// Picking one lets Waypoint show whether it is connected, and warn in the presenter view
// if it drops out during a talk.
import { clickerSettings, saveClicker } from './clicker.js';

/** 'desktop', 'hid' or null (this browser cannot list devices). */
export const deviceSource = () => (window.desktop?.bluetooth ? 'desktop' : typeof navigator !== 'undefined' && 'hid' in navigator ? 'hid' : null);

const hidId = d => `hid:${d.vendorId.toString(16)}:${d.productId.toString(16)}:${d.productName}`;
// Keyboard (generic desktop 0x01 / usage 6), keypad (7) or consumer control (page 0x0C):
// what clickers present themselves as.
const isInput = d => d.collections.some(c => (c.usagePage === 1 && [6, 7].includes(c.usage)) || c.usagePage === 12);

/** The devices to choose from: [{ id, name, connected, input }], clickers first. null when it could not be read. */
export async function listDevices() {
  let list;
  if (deviceSource() === 'desktop') list = await window.desktop.bluetooth.devices();
  else if (deviceSource() === 'hid') {
    const seen = new Map();
    for (const d of await navigator.hid.getDevices()) {
      const id = hidId(d);
      if (d.productName && !seen.has(id)) seen.set(id, { id, name: d.productName, connected: true, input: isInput(d) });
    }
    list = [...seen.values()];
  } else return null;
  if (!list) return null;
  return list.sort((a, b) => b.input - a.input || b.connected - a.connected || a.name.localeCompare(b.name));
}

/** Chrome and Edge: the browser's own list of devices, to allow one. Needs a click. Returns its id, or null. */
export async function findDevice() {
  const [d] = await navigator.hid.requestDevice({ filters: [] });
  return d ? hidId(d) : null;
}

/** The chosen clicker: { id, name } or null for any keyboard or clicker. */
export const chosenDevice = () => clickerSettings().device || null;
export function chooseDevice(device) {
  saveClicker({ ...clickerSettings(), device: device ? { id: device.id, name: device.name } : null });
  subs.forEach(fn => fn());
}
const subs = new Set();
export const onChosenChange = fn => { subs.add(fn); return () => subs.delete(fn); };

/** The chosen device in a list, matched by id, or by name when the system lists it under another address. */
export const findIn = (list, chosen) => chosen && list?.find(d => d.id === chosen.id) || list?.find(d => d.name === chosen?.name) || null;

/**
 * Calls onChange(connected: true | false | null) for the chosen clicker now and whenever it
 * changes (null: unknown, or no clicker chosen). Returns a function that stops watching.
 */
export function watchChosen(onChange, every = 20000) {
  let stopped = false, last;
  const report = v => { if (!stopped && v !== last) { last = v; onChange(v); } };
  const check = async () => {
    const chosen = chosenDevice();
    if (!chosen) return report(null);
    try { const list = await listDevices(); report(list ? Boolean(findIn(list, chosen)?.connected) : null); } catch { report(null); }
  };
  check();
  const timer = deviceSource() === 'desktop' ? setInterval(check, every) : null;
  const hid = deviceSource() === 'hid' ? navigator.hid : null;
  hid?.addEventListener('connect', check);
  hid?.addEventListener('disconnect', check);
  const off = onChosenChange(check);
  return () => { stopped = true; clearInterval(timer); hid?.removeEventListener('connect', check); hid?.removeEventListener('disconnect', check); off(); };
}

export const openBluetoothSettings = () => window.desktop?.bluetooth?.openSettings();
