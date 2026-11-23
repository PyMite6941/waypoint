// Opening the audience screen. Like Google Slides: if there is a second monitor the
// slides go full screen there and this window becomes the presenter's controller;
// with one monitor the slides open in a window of their own.
//
// Resolves to 'screen' (on another monitor), 'window' (a new window on this one)
// null (nothing could be opened, e.g. pop-ups are blocked) or 'retry' (we just
// asked for permission to use the other display; press Present again).

import { backgroundKeys } from './clicker.js';

const audienceUrl = at => `?audience&at=${at}`;

export async function openAudience(at) {
  if (window.desktop?.present) return window.desktop.present(at, backgroundKeys());   // Electron places it natively

  let features = 'popup,width=1280,height=720', where = 'window';
  // Window Management API (Chromium). Asks once for permission to see other screens.
  if (screen.isExtended && 'getScreenDetails' in window) {
    let asking = false;
    try { asking = (await navigator.permissions.query({ name: 'window-management' })).state === 'prompt'; } catch { /* older name */ }
    try {
      if (asking) {
        // The permission prompt uses up the click, so the browser would block the window.
        // Ask now; the next click on Present puts the slides on the other display.
        await window.getScreenDetails();
        return 'retry';
      }
      const details = await window.getScreenDetails();
      const other = details.screens.find(s => s !== details.currentScreen && !s.isInternal)
        || details.screens.find(s => s !== details.currentScreen);
      if (other) {
        features = `popup,fullscreen,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
        where = 'screen';
      }
    } catch { /* permission denied: fall back to a window here */ }
  }
  const win = window.open(audienceUrl(at), 'waypoint-audience', features);
  return win ? where : null;
}

export function closeAudience() {
  window.desktop?.endPresent?.();
}
