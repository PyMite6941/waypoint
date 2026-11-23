// Presentation clickers are tiny keyboards: almost all of them press Page Down / Page Up,
// some arrow keys, media keys or B / "." for a black screen, and the "start show" button
// sends F5, Shift+F5 or Esc. This is the one list of what each key does in a show, shared by
// the slides window, the presenter's controller and the desktop app's background shortcuts.
// Keys a particular clicker sends that are not listed can be taught in Clicker setup.

export const ACTIONS = { next: 'Next', prev: 'Previous', black: 'Black screen', ignore: 'Ignored (start/stop show)' };

const DEFAULTS = {
  next: ['PageDown', 'ArrowRight', 'ArrowDown', ' ', 'Enter', 'n', 'MediaTrackNext', 'BrowserForward'],
  prev: ['PageUp', 'ArrowLeft', 'ArrowUp', 'p', 'MediaTrackPrevious', 'BrowserBack'],
  black: ['b', '.'],
  ignore: ['F5'],   // never reload the page mid-talk
};
const STORE = 'waypoint.clicker';

/** A key press as one stable name: the key itself, or its physical code when the key has no name. */
export function keyId(e) {
  if (!e.key || e.key === 'Unidentified' || e.key === 'Process') return `code:${e.code}`;
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

/** How a key looks in the setup dialog. */
export function keyLabel(id) {
  return { ' ': 'Space', '.': 'Period (.)', ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', PageDown: 'Page Down', PageUp: 'Page Up' }[id]
    || id.replace(/^code:/, '').replace(/^[a-z]$/, c => c.toUpperCase());
}

/** Settings: keys taught in setup ({ next: [..], prev: [..], black: [..] }) and whether to work in the background. */
export function clickerSettings() {
  try { return { learned: {}, background: true, ...JSON.parse(localStorage.getItem(STORE)) }; } catch { return { learned: {}, background: true }; }
}
export function saveClicker(s) {
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private window: lasts this visit only */ }
}

/** What a key does in a show: 'next', 'prev', 'black', 'ignore' or null. Taught keys win over the defaults. */
export function actionOf(e, settings = clickerSettings()) {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const id = keyId(e);
  for (const [act, ids] of Object.entries(settings.learned || {})) if (ids.includes(id)) return act;
  for (const [act, ids] of Object.entries(DEFAULTS)) if (ids.includes(id)) return act;
  return null;
}

/** Keys that never type anything, so a clicker can use them even while a text box has focus. */
export const isClickerOnly = e => /^(Page(Up|Down)|Media|Browser(Back|Forward)|F\d+$|code:)/.test(keyId(e));

// The desktop app also listens for these when another app is in front. Only keys nobody
// types with: Page Up / Down, media keys and any taught F13-F24 / media keys, so the
// presenter can still type and use arrows in a demo app while the show runs.
const ACCELERATOR = { PageDown: 'PageDown', PageUp: 'PageUp', MediaTrackNext: 'MediaNextTrack', MediaTrackPrevious: 'MediaPreviousTrack' };
export function backgroundKeys(settings = clickerSettings()) {
  if (!settings.background) return {};
  const out = { PageDown: 'next', PageUp: 'prev', MediaNextTrack: 'next', MediaPreviousTrack: 'prev' };
  for (const [act, ids] of Object.entries(settings.learned || {})) {
    if (act === 'ignore') continue;
    for (const id of ids) {
      const acc = ACCELERATOR[id] || (/^F(1[3-9]|2[0-4])$/.test(id) ? id : null);
      if (acc) out[acc] = act;
    }
  }
  return out;
}

// A click that only brings a window to the front should not also change the slide:
// the presenter clicking back onto the slides (or the controller) after using another app.
let focusedAt = 0;
if (typeof window !== 'undefined') addEventListener('focus', e => { if (e.target === window) focusedAt = performance.now(); });
export const justFocused = () => performance.now() - focusedAt < 400;
