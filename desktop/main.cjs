// Desktop shell. Serves the built web app from dist/ and gives it native open and save
// dialogs, PDF export and automatic updates. Everything else lives in src/ and is shared
// with the web build, so the two have the same features.
const { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain, net, protocol, screen, shell } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.DEV_URL;   // set to the Vite dev server address for live reload
const preload = path.join(__dirname, 'preload.cjs');
let audience = null;      // the slides window opened by Present
const granted = new Set();   // paths the user picked in a dialog; the page may only write to these

// One app, one taskbar / Dock icon: the id matches the installer's shortcut so a pinned icon
// and the running window are the same button on Windows.
const APP_ID = 'io.github.pymite6941.waypoint';
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

// A second launch (a pinned icon, "Open with", the jump list) goes to the running app.
const primary = app.requestSingleInstanceLock();
if (!primary) app.exit(0);   // the running copy has the arguments already; quit() would wait for startup

// Presentations opened from the system: double-click, "Open with", dropped on the Dock or
// taskbar icon. Read here and handed to the editor, which imports them.
const OPENABLE = /\.(pptx|ppsx|potx|pptm|ppt|pps|key|odp|pdf|json|md|markdown|txt)$/i;
let pending = [];
async function openPaths(paths, win) {
  const files = [];
  for (const p of paths) {
    if (!OPENABLE.test(p)) continue;
    try { files.push({ name: path.basename(p), bytes: new Uint8Array(await fs.readFile(p)) }); } catch { /* gone or unreadable */ }
  }
  if (!files.length) return;
  const target = win || editor();
  if (target && !target.webContents.isLoading()) target.webContents.send('open-files', files);
  else pending.push(...files);
}
const pathsIn = argv => argv.slice(app.isPackaged ? 1 : 2).filter(a => !a.startsWith('-') && OPENABLE.test(a));
const editor = () => BrowserWindow.getAllWindows().find(w => w !== audience && !w.isDestroyed()) || null;

app.on('second-instance', (event, argv) => {
  if (argv.includes('--new-window')) { createWindow(); return; }
  const win = editor();
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  openPaths(pathsIn(argv));
});
app.on('open-file', (event, file) => {   // macOS: Finder, Dock icon
  event.preventDefault();
  if (app.isReady()) openPaths([file]); else pending.push(file);
});

// Security: only Waypoint's own pages may use the desktop bridge, windows never navigate
// away from Waypoint, and only web and mail links are handed to the system.
const isOurs = url => typeof url === 'string' && (url.startsWith('app://waypoint/') || Boolean(DEV_URL && url.startsWith(DEV_URL)));
const ownPage = event => isOurs(event.senderFrame?.url || '');
function openOutside(url) {
  try { if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) shell.openExternal(url); } catch { /* not a URL */ }
}
const SAFE = { contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, preload };
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (e, url) => { if (!isOurs(url)) { e.preventDefault(); openOutside(url); } });
  contents.on('will-redirect', (e, url) => { if (!isOurs(url)) e.preventDefault(); });
  contents.on('will-attach-webview', e => e.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (isOurs(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: SAFE } };
    openOutside(url);
    return { action: 'deny' };
  });
});

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function serve(request) {
  let file = path.join(DIST, decodeURIComponent(new URL(request.url).pathname));
  if (file.endsWith(path.sep)) file = path.join(file, 'index.html');
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return new Response('Forbidden', { status: 403 });
  return net.fetch(pathToFileURL(file).toString()).catch(() => new Response('Not found', { status: 404 }));
}

function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 820, title: 'Waypoint', autoHideMenuBar: true, icon: path.join(DIST, 'icon-512.png'), webPreferences: SAFE });
  win.webContents.on('did-finish-load', () => {
    const files = pending.filter(f => typeof f === 'object');
    const paths = pending.filter(f => typeof f === 'string');
    pending = [];
    if (files.length) win.webContents.send('open-files', files);
    if (paths.length) openPaths(paths, win);
  });
  win.loadURL(DEV_URL || 'app://waypoint/');
}

// Present: slides full screen on another display if there is one, otherwise in a
// window of their own. The window that asked stays as the presenter's controller.
// Clicker keys (Page Up / Down, media keys: never typing keys) are taken system-wide only
// while the slides are up, so the clicker still works after the presenter clicks into
// another app. They go to the slides window, which runs the show.
let clicker = [];
function grabClicker(keys) {
  dropClicker();
  for (const [acc, act] of Object.entries(keys || {})) {
    try {
      if (globalShortcut.register(acc, () => audience?.webContents.send('clicker', act))) clicker.push(acc);
    } catch { /* not a key this system knows */ }
  }
}
function dropClicker() {
  for (const acc of clicker) globalShortcut.unregister(acc);
  clicker = [];
}

ipcMain.handle('present:open', (event, at, keys) => {
  if (!ownPage(event)) throw new Error('Not allowed');
  const owner = BrowserWindow.fromWebContents(event.sender);
  const here = screen.getDisplayMatching(owner.getBounds());
  const other = screen.getAllDisplays().find(d => d.id !== here.id);
  audience?.destroy();
  const base = { title: 'Waypoint', autoHideMenuBar: true, backgroundColor: '#000000', webPreferences: SAFE };
  audience = other
    ? new BrowserWindow({ ...base, ...other.bounds, fullscreen: true, frame: false })
    : new BrowserWindow({ ...base, width: 1280, height: 720, x: here.workArea.x + 60, y: here.workArea.y + 60 });
  audience.on('closed', () => { audience = null; dropClicker(); });
  grabClicker(keys);
  audience.loadURL(`${DEV_URL || 'app://waypoint/'}?audience&at=${Number(at) || 0}`);
  return other ? 'screen' : 'window';
});
ipcMain.handle('present:end', event => { if (ownPage(event)) audience?.close(); });

// AI requests from the page, made here so provider CORS rules do not apply. Only the
// web (https) and this computer (http://localhost) are reachable; the reply comes back whole.
ipcMain.handle('ai:fetch', async (event, url, { method = 'GET', headers = {}, body } = {}) => {
  if (!ownPage(event)) throw new Error('Not allowed');
  const u = new URL(url);
  const local = u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) return { error: 'Only https addresses and local servers are allowed.' };
  try {
    const r = await fetch(u, { method, headers, body, signal: AbortSignal.timeout(10 * 60 * 1000) });
    return { status: r.status, statusText: r.statusText, headers: Object.fromEntries(r.headers), body: await r.text() };
  } catch (err) {
    return { error: err.message };
  }
});

// Files come and go as bytes, so the page can read and write any format.
ipcMain.handle('file:open', async (event, filters) => {
  if (!ownPage(event)) throw new Error('Not allowed');
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { properties: ['openFile'], filters });
  if (result.canceled) return null;
  const file = result.filePaths[0];
  granted.add(file);
  return { path: file, name: path.basename(file), data: new Uint8Array(await fs.readFile(file)) };
});

// `path` set and picked before: save straight there. Otherwise ask where.
ipcMain.handle('file:save', async (event, { path: wanted, name, data, filters }) => {
  if (!ownPage(event)) throw new Error('Not allowed');
  let file = wanted;
  if (!granted.has(file)) {
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), { defaultPath: wanted || name, filters });
    if (result.canceled) return null;
    file = result.filePath;
    granted.add(file);
  }
  await fs.writeFile(file, typeof data === 'string' ? data : Buffer.from(data));
  return { path: file, name: path.basename(file) };
});

// Download a presentation the user named by link (Google Slides, OneDrive, Dropbox…),
// without the browser's cross-site rules getting in the way. https only, up to 500 MB.
ipcMain.handle('net:get', async (event, url) => {
  if (!ownPage(event)) throw new Error('Not allowed');
  const u = new URL(url);
  if (u.protocol !== 'https:') return { error: 'Only https links can be opened.' };
  try {
    const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(5 * 60 * 1000), headers: { 'User-Agent': `Mozilla/5.0 Waypoint/${app.getVersion()}` } });
    if (+r.headers.get('content-length') > 500e6) return { error: 'The file is larger than 500 MB.' };
    return { status: r.status, type: r.headers.get('content-type') || '', disposition: r.headers.get('content-disposition') || '', url: r.url, data: new Uint8Array(await r.arrayBuffer()) };
  } catch (err) {
    return { error: err.cause?.message || err.message };
  }
});

// Export as PDF: the page has already laid out one slide per page for printing.
ipcMain.handle('pdf:save', async (event, name) => {
  if (!ownPage(event)) throw new Error('Not allowed');
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (result.canceled) return null;
  const pdf = await event.sender.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
  await fs.writeFile(result.filePath, pdf);
  return { path: result.filePath, name: path.basename(result.filePath) };
});

/* ---------- updates ---------- */

// Installed copies check GitHub Releases for a newer version at start and every few hours,
// download it in the background, and offer to restart. Where an update cannot install
// itself (an unsigned Mac build), the page offers the download page instead.
const RELEASES = 'https://github.com/PyMite6941/waypoint/releases/latest';
let update = { state: 'idle', current: app.getVersion() };
const tell = patch => {
  update = { ...update, ...patch };
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update', update);
};
let updater = null;
function startUpdates() {
  if (!app.isPackaged) return tell({ state: 'dev' });
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch { return tell({ state: 'error', message: 'Updater missing' }); }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => tell({ state: 'checking' }));
  updater.on('update-not-available', () => tell({ state: 'latest', checked: Date.now() }));
  updater.on('update-available', info => tell({ state: 'downloading', version: info.version, percent: 0 }));
  updater.on('download-progress', p => tell({ state: 'downloading', percent: Math.round(p.percent) }));
  updater.on('update-downloaded', info => tell({ state: 'ready', version: info.version }));
  updater.on('error', err => tell(update.version
    ? { state: 'manual', url: RELEASES, message: err.message }    // found one but could not fetch or install it
    : { state: 'error', message: err.message }));
  const check = () => updater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
}
ipcMain.handle('update:state', (event) => ownPage(event) && update);
ipcMain.handle('update:check', async (event) => {
  if (!ownPage(event)) throw new Error('Not allowed');
  if (!updater) return update;
  await updater.checkForUpdates().catch(err => tell({ state: 'error', message: err.message }));
  return update;
});
ipcMain.handle('update:install', (event) => {
  if (!ownPage(event)) throw new Error('Not allowed');
  if (update.state === 'ready') updater.quitAndInstall();
  else if (update.url) openOutside(update.url);
});

// API keys: a .env file in Waypoint's settings folder, or in the project folder when the app
// runs from source (the same file `npm run dev` uses). Only Waypoint's own pages may use it.
const envFile = () => (app.isPackaged ? path.join(app.getPath('userData'), '.env') : path.join(__dirname, '..', '.env'));
ipcMain.handle('env:read', async event => {
  if (!ownPage(event)) throw new Error('Not allowed');
  let text = '';
  try { text = await fs.readFile(envFile(), 'utf8'); } catch { /* no file yet */ }
  return { path: envFile(), text };
});
ipcMain.handle('env:write', async (event, text) => {
  if (!ownPage(event) || typeof text !== 'string' || text.length > 65536) throw new Error('Not allowed');
  await fs.mkdir(path.dirname(envFile()), { recursive: true });
  await fs.writeFile(envFile(), text, { mode: 0o600 });
});
ipcMain.handle('env:show', async event => {
  if (!ownPage(event)) return;
  try { await fs.access(envFile()); shell.showItemInFolder(envFile()); } catch { shell.openPath(path.dirname(envFile())); }
});

// Subscriptions through the vendor's own command-line tool, signed in by the person with
// their own account: Codex CLI (ChatGPT plan) and Gemini CLI (Google account). Only these two
// programs with these fixed arguments can be run, in an empty temporary folder, read-only;
// the prompt goes in on stdin.
const CLIS = {
  codex: { bin: 'codex', args: ({ model, out }) => ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', ...(model ? ['-m', model] : []), '-o', out, '-'], reply: 'file' },
  gemini: { bin: 'gemini', args: ({ model }) => ['-p', 'Follow the instructions given on standard input.', '--output-format', 'json', ...(model ? ['-m', model] : [])], reply: 'json' },
};
// Apps started from the Dock or Start menu do not get the terminal's PATH, so look where
// npm, Homebrew, nvm and friends put programs too.
async function searchPath() {
  const home = os.homedir();
  const dirs = (process.env.PATH || '').split(path.delimiter);
  if (process.platform === 'win32') dirs.push(path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm'), path.join(home, '.local', 'bin'));
  else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', path.join(home, '.npm-global', 'bin'), path.join(home, '.local', 'bin'), path.join(home, '.volta', 'bin'), path.join(home, '.bun', 'bin'));
    try { for (const v of await fs.readdir(path.join(home, '.nvm', 'versions', 'node'))) dirs.push(path.join(home, '.nvm', 'versions', 'node', v, 'bin')); } catch { /* no nvm */ }
  }
  return [...new Set(dirs.filter(Boolean))];
}
async function findBin(name) {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat'] : [''];
  for (const dir of await searchPath()) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext);
      try { await fs.access(file, process.platform === 'win32' ? undefined : require('node:fs').constants.X_OK); return file; } catch { /* keep looking */ }
    }
  }
  return null;
}
const running = new Map();
function stopRun(child) {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
  else child.kill('SIGTERM');
}
ipcMain.handle('cli:detect', async event => {
  if (!ownPage(event)) return {};
  const out = {};
  for (const [tool, t] of Object.entries(CLIS)) out[tool] = await findBin(t.bin);
  return out;
});
ipcMain.handle('cli:stop', (event, id) => { const child = running.get(id); if (child && ownPage(event)) stopRun(child); });
ipcMain.handle('cli:run', async (event, { id, tool, model = '', prompt } = {}) => {
  const t = CLIS[tool];
  if (!ownPage(event) || !t || typeof prompt !== 'string' || typeof id !== 'string') return { error: 'Not allowed' };
  if (model && !/^[\w.:/-]{1,100}$/.test(model)) return { error: `"${model}" does not look like a model name.` };
  const bin = await findBin(t.bin);
  if (!bin) return { missing: true };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-ai-'));
  const out = path.join(dir, 'reply.txt');
  const args = t.args({ model, out });
  const env = { ...process.env, PATH: (await searchPath()).join(path.delimiter), NO_COLOR: '1' };
  // npm installs these as .cmd scripts on Windows, which only cmd.exe can start.
  const viaCmd = /\.(cmd|bat)$/i.test(bin);
  const q = a => (/^[\w\-.:/\\=]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);
  const child = viaCmd
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[bin, ...args].map(q).join(' ')}"`], { cwd: dir, env, windowsHide: true, windowsVerbatimArguments: true })
    : spawn(bin, args, { cwd: dir, env, windowsHide: true });
  running.set(id, child);
  let stdout = '', stderr = '';
  const timer = setTimeout(() => stopRun(child), 10 * 60 * 1000);
  return new Promise(resolve => {
    child.stdout.on('data', d => { stdout += d; if (!event.sender.isDestroyed()) event.sender.send('cli:progress', id, stdout.length); });
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
    child.stdin.on('error', () => {});
    child.on('error', err => { clearTimeout(timer); running.delete(id); resolve({ error: err.message }); });
    child.on('close', async code => {
      clearTimeout(timer);
      running.delete(id);
      let text = '';
      if (t.reply === 'file') text = await fs.readFile(out, 'utf8').catch(() => '');
      else {
        const start = stdout.indexOf('{');
        try { const j = JSON.parse(stdout.slice(start)); text = typeof j.response === 'string' ? j.response : ''; if (!text && j.error) stderr = j.error.message || JSON.stringify(j.error); } catch { text = stdout; }
      }
      fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      if (text.trim()) resolve({ text });
      else resolve({ error: stderr.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ') || `${t.bin} stopped without a reply (exit code ${code}).` });
    });
    child.stdin.end(prompt);
  });
});

// Clickers: the Bluetooth devices paired with this computer, from the operating system, so
// the person can pick theirs in the Clicker menu. A clicker is a small keyboard, so its keys
// reach the show either way; picking it lets Waypoint say whether it is connected.
// Each entry: { id, name, connected, input } (input: it is a keyboard-like HID device).
const run = (cmd, args, timeout = 15000) => new Promise(resolve => {
  const child = spawn(cmd, args, { windowsHide: true });
  let out = '';
  const timer = setTimeout(() => child.kill(), timeout);
  child.stdout.on('data', d => { out += d; });
  child.on('error', () => { clearTimeout(timer); resolve(null); });
  child.on('close', () => { clearTimeout(timer); resolve(out); });
});
const WIN_BT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$devs = @(Get-PnpDevice -Class Bluetooth | Where-Object { $_.InstanceId -match '^BTH(ENUM|LE)\\DEV_' })
$hid = @(Get-PnpDevice -Class HIDClass,Keyboard,Mouse | Where-Object { $_.InstanceId -match '00001124|00001812' }).InstanceId -join ' '
$conn = @{}
if ($devs.Count) { Get-PnpDeviceProperty -InstanceId $devs.InstanceId -KeyName '{83DA6326-97A6-4088-9453-A1923F573B29} 15' | ForEach-Object { $conn[$_.InstanceId] = [bool]$_.Data } }
$list = foreach ($d in $devs) {
  $addr = (($d.InstanceId -split '\\')[1]).Substring(4)
  [pscustomobject]@{ id = $addr; name = $d.FriendlyName; connected = [bool]$conn[$d.InstanceId]; input = $hid.Contains($addr) }
}
ConvertTo-Json -Compress -InputObject @($list)`;
async function bluetoothDevices() {
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WIN_BT, 'utf16le').toString('base64')]);
    if (out === null) return null;
    const all = JSON.parse(out.trim() || '[]');
    // The same device can be listed twice (classic and Low Energy): keep one, connected first.
    const byName = new Map();
    for (const d of all) {
      const had = byName.get(d.name);
      if (!had || (d.connected && !had.connected) || (d.input && !had.input && d.connected === had.connected)) byName.set(d.name, d);
    }
    return [...byName.values()];
  }
  if (process.platform === 'darwin') {
    const out = await run('system_profiler', ['SPBluetoothDataType', '-json']);
    if (out === null) return null;
    const bt = JSON.parse(out).SPBluetoothDataType?.[0] || {};
    const list = [];
    for (const [key, connected] of [['device_connected', true], ['device_not_connected', false]]) {
      for (const entry of bt[key] || []) {
        for (const [name, d] of Object.entries(entry)) {
          list.push({ id: d.device_address || name, name, connected, input: /keyboard|remote|mouse|presenter|hid/i.test(`${d.device_minorType} ${name}`) });
        }
      }
    }
    return list;
  }
  const out = await run('bluetoothctl', ['devices', 'Paired']);
  if (out === null) return null;
  const list = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^Device ([0-9A-F:]{17}) (.+)$/i);
    if (!m) continue;
    const info = (await run('bluetoothctl', ['info', m[1]], 5000)) || '';
    list.push({ id: m[1], name: m[2].trim(), connected: /Connected: yes/.test(info), input: /Icon: input|UUID: Human Interface/i.test(info) });
  }
  return list;
}
ipcMain.handle('bluetooth:devices', async event => {
  if (!ownPage(event)) return null;
  try { return await bluetoothDevices(); } catch { return null; }
});
ipcMain.handle('bluetooth:settings', event => {
  if (!ownPage(event)) return;
  if (process.platform === 'win32') shell.openExternal('ms-settings:bluetooth');
  else if (process.platform === 'darwin') shell.openExternal('x-apple.systempreferences:com.apple.BluetoothSettings');
  else spawn('gnome-control-center', ['bluetooth'], { detached: true, stdio: 'ignore' }).on('error', () => spawn('blueman-manager', [], { detached: true, stdio: 'ignore' }).on('error', () => {}));
});

app.whenReady().then(() => {
  // Camera, microphone, location and the like: never for other sites; Waypoint's own pages only.
  const ses = require('electron').session.defaultSession;
  ses.setPermissionRequestHandler((contents, permission, callback, details) => callback(isOurs(details.requestingUrl || contents.getURL())));
  ses.setPermissionCheckHandler((contents, permission, origin) => isOurs(`${origin}/`));
  if (!primary) return;
  protocol.handle('app', serve);
  createWindow();
  startUpdates();
  pending.push(...pathsIn(process.argv));
  // Right-click menus on the pinned icon: the Windows jump list and the macOS Dock menu.
  if (process.platform === 'win32') app.setUserTasks([{ program: process.execPath, arguments: '--new-window', iconPath: process.execPath, iconIndex: 0, title: 'New window', description: 'Open another Waypoint window' }]);
  if (process.platform === 'darwin') app.dock.setMenu(Menu.buildFromTemplate([{ label: 'New Window', click: () => createWindow() }]));
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
