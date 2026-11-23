// Waypoint as an app of its own: an icon on the Windows taskbar, the macOS Dock or a phone's
// home screen. The web version installs from the browser (Chrome, Edge: a real app window
// with its own icon; Safari on a Mac: File, Add to Dock); the desktop app is installed already.
// Installed, both receive presentations opened from the system: the desktop app through
// window.desktop.onOpenFiles, the installed web app through the manifest's file_handlers.

let promptEvent = null;
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());

if (typeof window !== 'undefined') {
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptEvent = e; notify(); });
  addEventListener('appinstalled', () => { promptEvent = null; notify(); });
}

/** Re-run fn when installability changes. */
export const onInstallChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

/** Where we are: 'desktop' | 'installed' | 'prompt' | 'safari-mac' | 'ios' | 'other'. */
export function installState() {
  if (window.desktop) return 'desktop';
  if (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone) return 'installed';
  if (promptEvent) return 'prompt';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua)) return 'safari-mac';
  return 'other';
}

/** Shows the browser's install prompt. Resolves true when the person installed. */
export async function installApp() {
  if (!promptEvent) return false;
  const e = promptEvent;
  promptEvent = null;
  e.prompt();
  const { outcome } = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
  notify();
  return outcome === 'accepted';
}

export const platform = () => {
  const ua = navigator.userAgent;
  return /Windows/.test(ua) ? 'windows' : /Macintosh|Mac OS X/.test(ua) ? 'mac' : /CrOS/.test(ua) ? 'chromeos' : /Linux/.test(ua) ? 'linux' : 'other';
};

// Files the system asked us to open. Buffered until the editor subscribes.
let queued = [];
let consumer = null;
const deliver = files => { if (!files.length) return; if (consumer) consumer(files); else queued.push(...files); };
if (typeof window !== 'undefined') {
  window.desktop?.onOpenFiles?.(files => deliver(files.map(f => ({ name: f.name, bytes: f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes) }))));
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async params => {
      const files = [];
      for (const handle of params.files || []) {
        try { const f = await handle.getFile(); files.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }); } catch { /* permission refused */ }
      }
      deliver(files);
    });
  }
}
/** fn(files) runs for each batch of files opened from the system, including ones that came before. */
export function onOpenFiles(fn) {
  consumer = fn;
  if (queued.length) { const f = queued; queued = []; fn(f); }
  return () => { if (consumer === fn) consumer = null; };
}
