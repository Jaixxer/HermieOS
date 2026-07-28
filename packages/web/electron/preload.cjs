/**
 * Preload script — runs before the web page loads.
 * Exposes a minimal, safe API to the renderer via contextBridge.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hermieos', {
  version: () => ipcRenderer.invoke('app:version'),
  platform: () => ipcRenderer.invoke('app:platform'),
});
