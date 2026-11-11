// Desktop shell. Serves the built web app from dist/ and gives it native
// open and save dialogs. Everything else lives in src/ and is shared with the web build.
const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.DEV_URL;   // set to the Vite dev server address for live reload
const preload = path.join(__dirname, 'preload.cjs');
const granted = new Set();   // paths the user picked in a dialog; the page may only write to these

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function serve(request) {
  let file = path.join(DIST, decodeURIComponent(new URL(request.url).pathname));
  if (file.endsWith(path.sep)) file = path.join(file, 'index.html');
  if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
  return net.fetch(pathToFileURL(file).toString()).catch(() => new Response('Not found', { status: 404 }));
}

function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 820, title: 'Waypoint', autoHideMenuBar: true, webPreferences: { preload } });
  win.webContents.setWindowOpenHandler(({ url }) => {
    const ours = url.startsWith('app://') || (DEV_URL && url.startsWith(DEV_URL));
    if (ours) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { preload } } };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(DEV_URL || 'app://waypoint/');
}

ipcMain.handle('file:open', async (event, filters) => {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { properties: ['openFile'], filters });
  if (result.canceled) return null;
  const file = result.filePaths[0];
  granted.add(file);
  return { path: file, name: path.basename(file), text: await fs.readFile(file, 'utf8') };
});

ipcMain.handle('file:save', async (event, { path: wanted, name, text, filters }) => {
  let file = wanted;
  if (!granted.has(file)) {
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), { defaultPath: wanted || name, filters });
    if (result.canceled) return null;
    file = result.filePath;
    granted.add(file);
  }
  await fs.writeFile(file, text, 'utf8');
  return { path: file, name: path.basename(file) };
});

app.whenReady().then(() => {
  protocol.handle('app', serve);
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
