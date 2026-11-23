// Staying up to date.
//   Desktop app: the main process checks GitHub Releases, downloads in the background and
//     reports here (see desktop/main.cjs); the page shows "Restart to update".
//   Web: every build writes version.json. An open page checks it when it regains focus and
//     every 30 minutes, and offers a reload when a newer build is live. The service worker is
//     network-first, so the reload gets the new files.
// subscribe(fn) calls fn({ state, version, percent, url }) with state one of
//   idle | checking | latest | downloading | ready | manual | error | dev.
export const VERSION = __VERSION__;
export const BUILD = __BUILD__;

export function subscribe(fn) {
  const desktop = window.desktop?.update;
  if (desktop) {
    desktop.state().then(fn);
    return desktop.on(fn);
  }
  if (import.meta.env.DEV) { fn({ state: 'dev' }); return () => {}; }
  let stopped = false;
  async function check() {
    try {
      const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      const live = await r.json();
      if (!stopped) fn(live.build && live.build !== BUILD ? { state: 'ready', version: live.version } : { state: 'latest', checked: Date.now() });
    } catch { /* offline: try later */ }
  }
  check();
  const timer = setInterval(check, 30 * 60 * 1000);
  const onFocus = () => document.visibilityState === 'visible' && check();
  document.addEventListener('visibilitychange', onFocus);
  return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', onFocus); };
}

export const checkNow = () => window.desktop?.update?.check() ?? Promise.resolve(null);
// Apply: restart into the downloaded version (desktop), open the download page, or reload (web).
export function install(u) {
  if (window.desktop?.update) return window.desktop.update.install();
  if (u?.url) return window.open(u.url, '_blank', 'noopener');
  location.reload();
}
