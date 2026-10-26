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

contextBridge.exposeInMainWorld('electronSecure', {
  isAvailable: () => ipcRenderer.invoke('secure:available'),
  encrypt: (plaintext) => ipcRenderer.invoke('secure:encrypt', plaintext),
  decrypt: (base64) => ipcRenderer.invoke('secure:decrypt', base64),
});

// Read-only path lookup so the renderer can tell the user where on-device
// assistant model weights live (Chromium's Cache API/IndexedDB storage sits
// under this dir), see src/lib/assistant/model-storage.ts.
contextBridge.exposeInMainWorld('electronPaths', {
  getUserDataPath: () => ipcRenderer.invoke('app:user-data-path'),
});

// Per-host connection limit. Chromium reads it at startup, so a set() applies
// on the next launch; it resolves with the clamped value actually stored.
contextBridge.exposeInMainWorld('electronConnections', {
  get: () => ipcRenderer.invoke('app:max-connections-get'),
  set: (value) => ipcRenderer.invoke('app:max-connections-set', value),
});
