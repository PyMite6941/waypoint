// Makes the web version installable and usable offline (see public/sw.js).
// Skipped in the desktop app and in development.
export function enableOffline() {
  if (window.desktop || import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(reg => {
    const loaded = performance.getEntriesByType('resource').map(e => e.name).filter(url => url.startsWith(location.origin));
    reg.active.postMessage({ cache: [location.href.split(/[?#]/)[0], ...loaded] });
  }).catch(() => {});
}
