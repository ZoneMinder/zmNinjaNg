// Experimental Electron desktop shell for zmNinjaNg.
//
// Purpose: run the existing React app on Chromium (the same engine as Windows
// WebView2 and the web build) instead of the system WebKit that Tauri uses on
// macOS and Linux, to compare MJPEG memory behavior. The renderer is detected
// as a plain web page (no Tauri/Capacitor runtime), so it uses the browser
// <img src> streaming path. no Rust reader, no cache purge, no auto-restart.

const { app, BrowserWindow, Menu, nativeImage, shell } = require('electron');
const path = require('node:path');

// Reuse the Tauri-generated app icons so the desktop shell shows the zmNinjaNg
// logo instead of the default Electron logo (window, taskbar, and macOS dock).
const ICON_PATH = path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.png');

// The renderer fetches the user's ZoneMinder server, which generally does not
// send CORS headers, so same-origin enforcement is disabled (this is a desktop
// client hitting a user-configured server, like the Tauri/Capacitor builds).
// This is an experiment shell, not a hardened production build.
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'zmNinjaNg',
    icon: ICON_PATH,
    backgroundColor: '#0b0f14',
    // Avoid a black/blank flash on launch: stay hidden until the first paint.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow cross-origin requests to the ZoneMinder server and mixed content.
      webSecurity: false,
    },
  });

  // Reveal once content is ready. ready-to-show can fail to fire on some
  // Wayland/GPU setups, leaving the window hidden even though the app loaded,
  // so also reveal on did-finish-load and a timeout fallback.
  const reveal = () => { if (!win.isDestroyed() && !win.isVisible()) win.show(); };
  win.once('ready-to-show', reveal);
  win.webContents.once('did-finish-load', reveal);
  setTimeout(reveal, 4000);

  win.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error(`did-fail-load ${code} ${desc} ${url}`);
    reveal();
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`render-process-gone ${JSON.stringify(details)}`);
  });

  // Right-click context menu with Inspect Element (DevTools no longer opens
  // automatically; this is how you reach it on demand).
  win.webContents.on('context-menu', (_event, params) => {
    Menu.buildFromTemplate([
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'reload' },
      {
        label: 'Inspect Element',
        click: () => win.webContents.inspectElement(params.x, params.y),
      },
    ]).popup({ window: win });
  });

  // Open external links (http/https that aren't our app) in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// Accept self-signed certificates (ZoneMinder servers commonly use them).
app.on('certificate-error', (event, _webContents, _url, _error, _cert, callback) => {
  event.preventDefault();
  callback(true);
});

app.whenReady().then(() => {
  // macOS dock shows the default Electron icon when launched via the electron
  // binary (dev/start). Packaged builds get the icon from electron-builder.
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = nativeImage.createFromPath(ICON_PATH);
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
