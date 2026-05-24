// Minimal preload. The React app runs as a normal web page under Electron, so
// nothing needs to be bridged for basic operation. A flag is exposed only so
// the app can detect the Electron shell if it ever needs to.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__ZMNINJA_ELECTRON__', true);
