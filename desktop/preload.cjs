// The only bridge between the page and the operating system.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  open: filters => ipcRenderer.invoke('file:open', filters),
  save: request => ipcRenderer.invoke('file:save', request),
});
