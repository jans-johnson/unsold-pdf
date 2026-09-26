'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

function on(channel, handler) {
  const listener = (_event, ...args) => handler(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('desktop', {
  ready: () => ipcRenderer.send('renderer:ready'),
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  openPaths: (paths) => ipcRenderer.invoke('files:open-paths', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  listRecents: () => ipcRenderer.invoke('recents:list'),
  removeRecent: (p) => ipcRenderer.invoke('recents:remove', p),
  clearRecents: () => ipcRenderer.invoke('recents:clear'),
  save: (path, data) => ipcRenderer.invoke('file:save', { path, data }),
  saveAs: (name, data, directory) =>
    ipcRenderer.invoke('file:save-as', { name, data, directory }),
  reveal: (p) => ipcRenderer.invoke('file:reveal', p),
  confirm: (opts) => ipcRenderer.invoke('dialog:confirm', opts),
  closeConfirmed: () => ipcRenderer.send('app:close-confirmed'),
  closeCancelled: () => ipcRenderer.send('app:close-cancelled'),
  setTitle: (t) => ipcRenderer.send('window:title', t),
  setRepresentedFile: (p, edited) =>
    ipcRenderer.send('window:represented-file', p, edited),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  onFilesOpen: (fn) => on('files:open', fn),
  onToolOutput: (fn) => on('tool:output', fn),
  onMenu: (fn) => on('menu', fn),
  onToast: (fn) => on('toast', fn),
  onBeforeClose: (fn) => on('app:before-close', fn),
});
