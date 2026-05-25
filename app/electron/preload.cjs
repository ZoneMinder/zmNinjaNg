// Preload for the Electron shell. Exposes a detection flag and a native HTTP
// bridge so the renderer can route requests through the main process (Chromium's
// net stack), mirroring how the Tauri build routes HTTP through its Rust core.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__ZMNINJA_ELECTRON__', true);

contextBridge.exposeInMainWorld('electronHttp', {
  request: (req) => ipcRenderer.invoke('http:request', req),
});

contextBridge.exposeInMainWorld('electronSsl', {
  setTrustSelfSigned: (enabled) => ipcRenderer.invoke('ssl:set-trust', enabled),
});
