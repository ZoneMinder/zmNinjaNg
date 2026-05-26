// Experimental Electron desktop shell for zmNinjaNg.
//
// Purpose: run the existing React app on Chromium (the same engine as Windows
// WebView2 and the web build) instead of the system WebKit that Tauri uses on
// macOS and Linux, to compare MJPEG memory behavior. The renderer is detected
// as a plain web page (no Tauri/Capacitor runtime), so it uses the browser
// <img src> streaming path. no Rust reader, no cache purge, no auto-restart.

const { app, BrowserWindow, Menu, nativeImage, net, ipcMain, session, shell } = require('electron');
const path = require('node:path');

// Lift Chromium's default 6-connection-per-origin cap so Montage views with
// many MJPEG tiles aren't bottlenecked. Each MJPEG stream holds an HTTP/1.1
// connection open for as long as the tile is on screen; 6 monitors saturates
// the pool and starves the rest of the app. Must be set before app.whenReady().
app.commandLine.appendSwitch('max-connections-per-host', '32');

// Whether to trust self-signed/invalid TLS certificates. Secure default: reject
// until the renderer enables it during bootstrap, gated on the per-profile
// allowSelfSignedCerts setting (see src/lib/ssl-trust.ts applySSLTrustSetting).
let trustSelfSigned = false;

// Native HTTP from the main process, bridged to the renderer over IPC (see
// electron/preload.cjs). This mirrors the Tauri build, which performs requests
// in its Rust core: running outside the renderer avoids CORS, and the cert
// handling in app.whenReady lets self-signed ZoneMinder servers work.
ipcMain.handle('http:request', async (_event, req) => {
  const { url, method, headers, body, responseType, timeoutMs } = req;
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await net.fetch(url, {
      method,
      headers,
      body: body ?? undefined,
      signal: controller.signal,
    });
    const responseHeaders = {};
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });
    const isBinary =
      responseType === 'blob' || responseType === 'arraybuffer' || responseType === 'base64';
    let bodyText;
    let bodyBase64;
    if (isBinary) {
      bodyBase64 = Buffer.from(await response.arrayBuffer()).toString('base64');
    } else {
      bodyText = await response.text();
    }
    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      bodyText,
      bodyBase64,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
});

// Renderer toggles self-signed cert trust to match the per-profile setting.
ipcMain.handle('ssl:set-trust', (_event, enabled) => {
  trustSelfSigned = !!enabled;
  return true;
});

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

// Accept self-signed certificates only when the active profile allows it.
app.on('certificate-error', (event, _webContents, _url, _error, _cert, callback) => {
  if (trustSelfSigned) {
    event.preventDefault();
    callback(true);
  }
  // else: do NOT preventDefault -> Chromium rejects the invalid cert (default).
});

app.whenReady().then(() => {
  // Trust self-signed certs for main-process net requests too. The
  // certificate-error handler above only covers renderer loads; net.fetch (used
  // by the http:request bridge) is verified via the session, so gate it on the
  // same flag so self-signed ZoneMinder servers work like they do in the renderer.
  session.defaultSession.setCertificateVerifyProc((_request, callback) => {
    // 0 = force-trust; -3 = use Chromium's default verification (rejects self-signed).
    callback(trustSelfSigned ? 0 : -3);
  });

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
