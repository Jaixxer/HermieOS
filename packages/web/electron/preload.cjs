/**
 * Preload script — runs before the web page loads.
 * Exposes a minimal, safe API to the renderer via contextBridge.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hermieos', {
  version: () => ipcRenderer.invoke('app:version'),
  platform: () => ipcRenderer.invoke('app:platform'),
  /** Show a native OS notification (notification center). */
  notify: (payload) => ipcRenderer.send('hermieos:notify', payload),
  /** Subscribe to "notification clicked → open URL" events. */
  onNavigate: (cb) => {
    ipcRenderer.on('hermieos:navigate', (_event, url) => cb(url));
  },
});
