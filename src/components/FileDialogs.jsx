import { useEffect, useState } from 'react';
import { IMPORT_TYPES } from '../lib/convert/import.js';
import { importLink } from '../lib/convert/links.js';
import { pickFiles, readDropped } from '../lib/files.js';
import { VERSION, checkNow, install } from '../lib/updates.js';
import { installApp, installState, onInstallChange, platform } from '../lib/install.js';
import { Modal } from './AiDialogs.jsx';

/* ---------- open / import ---------- */

// Pick a file, drop one, or paste a link to a presentation. `onFiles(files, mode)` imports
// [{ name, bytes }]; `onResult(result, mode)` takes an already imported deck (from a link).
export function ImportDialog({ onFiles, onResult, onClose, busy }) {
  const [mode, setMode] = useState('replace');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [over, setOver] = useState(false);
  const [loading, setLoading] = useState('');

  async function choose() {
    const files = await pickFiles();
    if (files.length) onFiles(files, mode);
  }
  async function fromLink() {
    setError(''); setHint('');
    try {
      const result = await importLink(link, { onStatus: setLoading });
      setLoading('');
      if (result.manual) setHint(`Your browser is not allowed to download it for Waypoint, so it opened in a new tab. When the download finishes, drop the file here (or click Choose file). If the site asks you to sign in, the deck is private. ${result.help}`);
      else onResult(result, mode);
    } catch (err) { setLoading(''); setError(err.message); }
  }

  return (
    <Modal title="Open or import" onClose={onClose} wide>
      <div className="form">
        <div
          className={`drop${over ? ' over' : ''}`}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={async e => { e.preventDefault(); e.stopPropagation(); setOver(false); const files = await readDropped(e.dataTransfer.files); if (files.length) onFiles(files, mode); }}
        >
          {busy || loading
            ? <><div className="spinner" /><p>{busy || loading}</p></>
            : <><p><b>Drop a file here</b> or</p><button className="primary" onClick={choose}>Choose file…</button></>}
        </div>
        <ul className="formats">
          {IMPORT_TYPES.map(t => <li key={t.name}><b>{t.name}</b> <span className="dim">.{t.ext.slice(0, 2).join(', .')}</span><br /><span className="dim">{t.note}</span></li>)}
        </ul>
        <label>Link to a presentation
          <span className="row">
            <input value={link} placeholder="Google Slides, or a PowerPoint on OneDrive, SharePoint, Google Drive or Dropbox" spellCheck={false} onChange={e => setLink(e.target.value)} onKeyDown={e => e.key === 'Enter' && link.trim() && !loading && fromLink()} />
            <button disabled={!link.trim() || !!busy || !!loading} onClick={fromLink}>Open link</button>
          </span>
        </label>
        <p className="hint">
          Works for presentations shared as &ldquo;Anyone with the link&rdquo;, and for direct links to .pptx, .key, .odp or .pdf files.
          Waypoint downloads the file, reads it and remembers the link: File, Update from link gets the latest version before your talk.
          {!window.desktop && ' In a browser, most sites only let you download the file yourself; Waypoint opens it for you to drop in. The desktop app downloads it directly.'}
        </p>
        {hint && <p className="status">{hint}</p>}
        <fieldset className="choose">
          <label className="check"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Open as the deck (Undo brings this one back)</label>
          <label className="check"><input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} /> Add its slides after the current slide</label>
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

/* ---------- export ---------- */

export const EXPORTS = {
  pptx: { name: 'PowerPoint', ext: '.pptx', note: 'Edit in PowerPoint or Keynote. Keeps layout, colours, fonts, notes, links, transitions and builds.' },
  google: { name: 'Google Slides', ext: '.pptx', note: 'Saves a .pptx; in Google Drive choose New, File upload, then open it with Google Slides.' },
  pdf: { name: 'PDF', ext: '.pdf', note: 'One page per slide, exactly as it looks. Best for sending and printing.' },
  png: { name: 'Pictures', ext: '.zip', note: 'Every slide as a 1920 × 1080 PNG.' },
  waypoint: { name: 'Waypoint', ext: '.waypoint.json', note: 'Everything, to open again here or in the Java presenter.' },
};
export function preferredExport() { try { const v = localStorage.getItem('waypoint.export'); return v in EXPORTS ? v : 'pptx'; } catch { return 'pptx'; } }
const remember = v => { try { localStorage.setItem('waypoint.export', v); } catch { /* private window */ } };

export function ExportDialog({ onExport, onClose, busy }) {
  const [pick, setPick] = useState(preferredExport);
  return (
    <Modal title="Export" onClose={onClose}>
      <div className="form">
        <div className="exportList" role="radiogroup">
          {Object.entries(EXPORTS).map(([id, x]) => (
            <label key={id} className={`exportItem${pick === id ? ' on' : ''}`}>
              <input type="radio" name="fmt" checked={pick === id} onChange={() => setPick(id)} />
              <span><b>{x.name}</b> <span className="dim">{x.ext}</span><br /><span className="dim">{x.note}</span></span>
            </label>
          ))}
        </div>
        {busy && <p className="status"><span className="spinner small" /> {busy}</p>}
        <p className="hint">Your choice is remembered: File, Export as uses it straight away (Ctrl+Shift+S).</p>
      </div>
      <footer><span className="grow" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={!!busy} onClick={() => { remember(pick); onExport(pick); }}>Export {EXPORTS[pick].name}</button></footer>
    </Modal>
  );
}

/* ---------- updates ---------- */

// A slim bar under the toolbar when a newer version is ready.
export function UpdateBar({ update, onDismiss }) {
  if (!['ready', 'manual'].includes(update?.state)) return null;
  const desktop = !!window.desktop;
  return (
    <div className="updateBar" role="status">
      <span>
        {update.state === 'manual'
          ? `Waypoint ${update.version} is out. This copy cannot update itself, so download it from the release page.`
          : desktop ? `Waypoint ${update.version || ''} is downloaded and ready.` : 'A new version of Waypoint is live.'}
      </span>
      <button className="primary" onClick={() => install(update)}>{update.state === 'manual' ? 'Download' : desktop ? 'Restart to update' : 'Reload'}</button>
      <button className="link" onClick={onDismiss}>Later</button>
    </div>
  );
}

export function AboutDialog({ update, onClose }) {
  const [checking, setChecking] = useState(false);
  useEffect(() => { if (window.desktop) { setChecking(true); checkNow().finally(() => setChecking(false)); } }, []);
  const s = update?.state;
  const line = checking || s === 'checking' ? 'Checking for updates…'
    : s === 'downloading' ? `Downloading ${update.version}… ${update.percent || 0}%`
      : s === 'ready' ? `Version ${update.version || 'new'} is ready.`
        : s === 'manual' ? `Version ${update.version} is available to download.`
          : s === 'latest' ? 'You have the latest version.'
            : s === 'dev' ? 'Development build: updates are off.'
              : s === 'error' ? `Could not check for updates (${update.message || 'offline?'}).` : '';
  return (
    <Modal title="About Waypoint" onClose={onClose}>
      <div className="form">
        <p><b>Waypoint {VERSION}</b> · {window.desktop ? 'desktop app' : 'web version'}</p>
        <p className="status">{line}</p>
        <p className="hint">
          {window.desktop
            ? 'The app checks GitHub for new releases when it starts and every few hours, downloads them in the background and installs on restart.'
            : 'The web version updates itself: when a new version goes live, a bar offers to reload. Installed as an app, it works offline too.'}
        </p>
      </div>
      <footer>
        <a href="https://github.com/PyMite6941/waypoint/releases" target="_blank" rel="noopener">Release notes</a>
        <span className="grow" />
        {['ready', 'manual'].includes(s) && <button onClick={() => install(update)}>{s === 'manual' ? 'Download' : window.desktop ? 'Restart to update' : 'Reload'}</button>}
        <button className="primary" onClick={onClose}>Done</button>
      </footer>
    </Modal>
  );
}

// Install as an app, then pin it: the taskbar on Windows, the Dock on a Mac.
export function InstallDialog({ onClose }) {
  const [state, setState] = useState(installState);
  useEffect(() => onInstallChange(() => setState(installState())), []);
  const os = platform();
  const pin = os === 'mac'
    ? <>Right-click the Waypoint icon in the Dock and choose <b>Options, Keep in Dock</b>. It is also in Launchpad and the Applications folder.</>
    : os === 'windows'
      ? <>Right-click the Waypoint icon on the taskbar and choose <b>Pin to taskbar</b>. It is also in the Start menu (search &ldquo;Waypoint&rdquo;), where you can pin it to Start.</>
      : os === 'chromeos' ? <>Right-click its icon in the shelf and choose <b>Pin</b>.</>
        : <>Right-click its icon in your dock or panel and choose to keep or pin it.</>;
  const releases = 'https://github.com/PyMite6941/waypoint/releases/latest';
  return (
    <Modal title="Waypoint as an app" onClose={onClose}>
      <div className="form">
        {state === 'desktop' && <p>This is the Waypoint desktop app. {pin}</p>}
        {state === 'installed' && <p>Waypoint is installed as an app. {pin}</p>}
        {state === 'prompt' && (
          <>
            <p>Install Waypoint as an app: it gets its own window and icon, opens from the {os === 'mac' ? 'Dock and Launchpad' : os === 'windows' ? 'taskbar and Start menu' : 'app launcher'}, works offline and keeps updating itself.</p>
            <p className="hint">After installing: {pin}</p>
          </>
        )}
        {state === 'safari-mac' && (
          <>
            <p>In Safari choose <b>File, Add to Dock</b> (or the Share button, then <b>Add to Dock</b>). Waypoint then opens in its own window from the Dock and Launchpad, and works offline.</p>
            <p className="hint">Needs macOS Sonoma or later. Chrome and Edge can install it too (the install icon at the right of the address bar).</p>
          </>
        )}
        {state === 'ios' && <p>Tap the <b>Share</b> button, then <b>Add to Home Screen</b>.</p>}
        {state === 'other' && (
          <>
            <p>Open this page in <b>Chrome</b> or <b>Edge</b> and use the install icon at the right of the address bar (or the menu, <b>Cast, save and share, Install page as app</b>). {os === 'mac' && <>In Safari: <b>File, Add to Dock</b>.</>}</p>
            <p className="hint">Then: {pin}</p>
          </>
        )}
        {state !== 'desktop' && (
          <p className="hint">
            Prefer a full desktop app? It adds native open and save dialogs, opens .pptx, Keynote and other files by double-click, and keeps the clicker working while another app is in front.{' '}
            <a href={releases} target="_blank" rel="noopener">Download for {os === 'mac' ? 'macOS' : os === 'windows' ? 'Windows' : os === 'linux' ? 'Linux' : 'your computer'}</a>.
          </p>
        )}
      </div>
      <footer>
        <span className="grow" />
        {state === 'prompt' && <button className="primary" onClick={async () => { if (await installApp()) onClose(); }}>Install Waypoint</button>}
        <button className={state === 'prompt' ? undefined : 'primary'} onClick={onClose}>{state === 'prompt' ? 'Not now' : 'Done'}</button>
      </footer>
    </Modal>
  );
}
