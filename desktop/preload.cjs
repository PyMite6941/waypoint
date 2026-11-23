// The only bridge between the page and the operating system.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  open: filters => ipcRenderer.invoke('file:open', filters),
  save: request => ipcRenderer.invoke('file:save', request),
  present: (at, keys) => ipcRenderer.invoke('present:open', at, keys),
  onClicker: fn => { const h = (e, act) => fn(act); ipcRenderer.on('clicker', h); return () => ipcRenderer.removeListener('clicker', h); },
  endPresent: () => ipcRenderer.invoke('present:end'),
  aiFetch: (url, init) => ipcRenderer.invoke('ai:fetch', url, init),
  get: url => ipcRenderer.invoke('net:get', url),
  savePdf: name => ipcRenderer.invoke('pdf:save', name),
  // Presentations opened from the system (double-click, Open with, the taskbar or Dock icon).
  onOpenFiles: fn => { const h = (e, files) => fn(files); ipcRenderer.on('open-files', h); return () => ipcRenderer.removeListener('open-files', h); },
  // API keys in a .env file (see src/lib/keys.js).
  env: {
    read: () => ipcRenderer.invoke('env:read'),
    write: text => ipcRenderer.invoke('env:write', text),
    show: () => ipcRenderer.invoke('env:show'),
  },
  // Paired Bluetooth devices, for the Clicker menu.
  bluetooth: {
    devices: () => ipcRenderer.invoke('bluetooth:devices'),
    openSettings: () => ipcRenderer.invoke('bluetooth:settings'),
  },
  // Subscriptions through Codex CLI or Gemini CLI.
  cli: {
    detect: () => ipcRenderer.invoke('cli:detect'),
    run: request => ipcRenderer.invoke('cli:run', request),
    stop: id => ipcRenderer.invoke('cli:stop', id),
    onProgress: fn => { const h = (e, id, n) => fn(id, n); ipcRenderer.on('cli:progress', h); return () => ipcRenderer.removeListener('cli:progress', h); },
  },
  // Uninstall Waypoint (see main.cjs): what it would do, and doing it.
  uninstall: { info: () => ipcRenderer.invoke('app:uninstallInfo'), run: wipe => ipcRenderer.invoke('app:uninstall', { wipe }) },
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    on: fn => { const h = (e, u) => fn(u); ipcRenderer.on('update', h); return () => ipcRenderer.removeListener('update', h); },
  },
});
