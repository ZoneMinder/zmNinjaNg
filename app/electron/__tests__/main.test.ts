/**
 * Electron main.cjs IPC handler tests (refs #217).
 *
 * main.cjs registers ipcMain.handle()/app.on() callbacks as side effects of
 * being required, and only the pure window-state helpers were previously
 * unit-tested. This mocks the 'electron' module, captures the registered
 * handler functions, and invokes them directly - the same approach the
 * preload script's contextBridge relies on at runtime.
 *
 * Not covered here (would need a running Electron main process / a fuller
 * BrowserWindow harness than is worth building for unit tests):
 *   - createWindow()'s window-state persistence wiring (resize/move/close
 *     listeners actually calling saveWindowState) - the underlying
 *     isBoundsVisible/loadWindowState/saveWindowState helpers are unit
 *     tested directly in window-state.test.ts.
 *   - The did-fail-load / render-process-gone / context-menu webContents
 *     listeners and the external-link window-open handler.
 *   - Real OS keychain/libsecret/DPAPI behavior behind safeStorage (mocked
 *     here).
 * These need an Appium/Playwright-for-Electron integration harness per
 * AGENTS.md rule 27 (native/Electron changes need a manual device pass).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const ipcHandlers: Record<string, Handler> = {};
const appOnHandlers: Record<string, (...args: unknown[]) => unknown> = {};

const mockNetFetch = vi.fn();
const mockSetCertificateVerifyProc = vi.fn();
const mockAppendSwitch = vi.fn();
const mockAppQuit = vi.fn();
const mockRequestSingleInstanceLock = vi.fn().mockReturnValue(true);

const mockSafeStorage = {
  isEncryptionAvailable: vi.fn().mockReturnValue(true),
  encryptString: vi.fn((plaintext: string) => Buffer.from(`enc:${plaintext}`)),
  decryptString: vi.fn((buf: Buffer) => buf.toString('utf8').replace(/^enc:/, '')),
};

// BrowserWindow instances created by createWindow(); good enough to let
// app.whenReady()'s callback run to completion without throwing, so the
// session.setCertificateVerifyProc registration (also inside that callback)
// actually happens and can be tested.
const browserWindowInstances: Array<Record<string, unknown>> = [];
function makeFakeBrowserWindow() {
  const listeners: Record<string, () => void> = {};
  const win = {
    on: vi.fn((event: string, cb: () => void) => {
      listeners[event] = cb;
    }),
    once: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    isVisible: vi.fn().mockReturnValue(false),
    isMaximized: vi.fn().mockReturnValue(false),
    maximize: vi.fn(),
    show: vi.fn(),
    isMinimized: vi.fn().mockReturnValue(true),
    restore: vi.fn(),
    focus: vi.fn(),
    getNormalBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 1280, height: 800 }),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    webContents: {
      on: vi.fn(),
      once: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      inspectElement: vi.fn(),
    },
    _listeners: listeners,
  };
  browserWindowInstances.push(win);
  return win;
}

const fakeElectron = {
  app: {
    commandLine: { appendSwitch: mockAppendSwitch },
    // Resolve immediately so createWindow() + the cert-verify-proc
    // registration (both inside this callback in the real module) run.
    whenReady: () => Promise.resolve(),
    on: (event: string, cb: (...args: unknown[]) => unknown) => {
      appOnHandlers[event] = cb;
    },
    dock: undefined,
    getPath: vi.fn().mockReturnValue('/tmp/zmninja-ng-test-userdata'),
    quit: mockAppQuit,
    requestSingleInstanceLock: mockRequestSingleInstanceLock,
  },
  BrowserWindow: Object.assign(
    vi.fn().mockImplementation(() => makeFakeBrowserWindow()),
    { getAllWindows: vi.fn().mockReturnValue([]) }
  ),
  Menu: { buildFromTemplate: vi.fn().mockReturnValue({ popup: vi.fn() }) },
  nativeImage: { createFromPath: vi.fn().mockReturnValue({ isEmpty: () => true }) },
  net: { fetch: (...args: unknown[]) => mockNetFetch(...args) },
  ipcMain: {
    handle: (name: string, fn: Handler) => {
      ipcHandlers[name] = fn;
    },
  },
  session: { defaultSession: { setCertificateVerifyProc: mockSetCertificateVerifyProc } },
  shell: { openExternal: vi.fn() },
  safeStorage: mockSafeStorage,
  screen: { getAllDisplays: vi.fn().mockReturnValue([]) },
};

beforeAll(async () => {
  // main.cjs is a plain CommonJS file that calls the real Node `require()`
  // for 'electron' internally; outside a running Electron process that
  // returns just a string (the path to the Electron binary), not the
  // {app, BrowserWindow, ...} API, and vi.mock() does not intercept it since
  // this require chain never goes through Vite's SSR module graph. Instead,
  // pre-populate Node's own require cache for the resolved 'electron' path so
  // main.cjs's `require('electron')` call resolves to our fake module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Module = require('node:module');
  const electronPath = require.resolve('electron');
  const fakeModule = new Module(electronPath, null);
  fakeModule.exports = fakeElectron;
  fakeModule.loaded = true;
  (require.cache as Record<string, unknown>)[electronPath] = fakeModule;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../main.cjs');
  // Flush the app.whenReady().then(...) microtask chain so createWindow()
  // and the setCertificateVerifyProc registration have run.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe('http:request handler', () => {
  it('returns status/headers/text body for a JSON request', async () => {
    mockNetFetch.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      arrayBuffer: async () => new TextEncoder().encode('{}').buffer,
      text: async () => '{"ok":true}',
    });

    const result = await ipcHandlers['http:request'](null, {
      url: 'https://zm.example.com/api/host/getVersion.json',
      method: 'GET',
      headers: { Authorization: 'Bearer x' },
      responseType: 'json',
    });

    expect(mockNetFetch).toHaveBeenCalledWith(
      'https://zm.example.com/api/host/getVersion.json',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer x' } })
    );
    expect(result).toMatchObject({ status: 200, statusText: 'OK', bodyText: '{"ok":true}' });
    expect((result as { headers: Record<string, string> }).headers['content-type']).toBe('application/json');
  });

  it('base64-encodes the body for a binary responseType', async () => {
    const bytes = new TextEncoder().encode('binary-data');
    mockNetFetch.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: new Map(),
      arrayBuffer: async () => bytes.buffer,
      text: async () => {
        throw new Error('should not be called for binary responseType');
      },
    });

    const result = (await ipcHandlers['http:request'](null, {
      url: 'https://zm.example.com/cgi-bin/nph-zms?mode=single',
      method: 'GET',
      responseType: 'base64',
    })) as { bodyBase64: string };

    expect(result.bodyBase64).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('aborts the underlying fetch when timeoutMs elapses', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    mockNetFetch.mockImplementationOnce(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise(() => {
          capturedSignal = opts.signal;
        })
    );

    // Fire-and-forget: this promise deliberately never resolves in this test
    // (net.fetch never settles), we only care that the signal aborts on time.
    void ipcHandlers['http:request'](null, {
      url: 'https://zm.example.com/slow',
      method: 'GET',
      timeoutMs: 5000,
    });

    await vi.advanceTimersByTimeAsync(5000);

    expect(capturedSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('returns a transport failure as a structured error envelope, not a rejection', async () => {
    // The handler must not reject: a rejecting ipcMain.handle logs
    // "Error occurred in handler for 'http:request'". A refused connection is a
    // normal HTTP outcome, returned as { ok: false } for the renderer adapter to
    // rethrow (adapter-electron.ts).
    const err = Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' });
    mockNetFetch.mockRejectedValueOnce(err);

    const result = await ipcHandlers['http:request'](null, {
      url: 'https://zm.example.com/down',
      method: 'GET',
    });

    expect(result).toEqual({
      ok: false,
      error: { name: 'TypeError', message: 'ECONNREFUSED' },
    });
  });

  it('returns a timeout as a structured AbortError envelope', async () => {
    vi.useFakeTimers();
    mockNetFetch.mockImplementationOnce(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          );
        })
    );

    const promise = ipcHandlers['http:request'](null, {
      url: 'https://zm.example.com/slow',
      method: 'GET',
      timeoutMs: 5000,
    });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result).toEqual({
      ok: false,
      error: { name: 'AbortError', message: 'Request timed out after 5000ms' },
    });
    vi.useRealTimers();
  });
});

describe('ssl:set-trust + certificate-error', () => {
  it('toggles trust and the renderer certificate-error handler follows it', () => {
    const event1 = { preventDefault: vi.fn() };
    const callback1 = vi.fn();

    expect(ipcHandlers['ssl:set-trust'](null, true)).toBe(true);
    appOnHandlers['certificate-error'](event1, null, 'https://self-signed.example.com', 'err', {}, callback1);
    expect(event1.preventDefault).toHaveBeenCalled();
    expect(callback1).toHaveBeenCalledWith(true);

    const event2 = { preventDefault: vi.fn() };
    const callback2 = vi.fn();
    expect(ipcHandlers['ssl:set-trust'](null, false)).toBe(true);
    appOnHandlers['certificate-error'](event2, null, 'https://self-signed.example.com', 'err', {}, callback2);
    expect(event2.preventDefault).not.toHaveBeenCalled();
    expect(callback2).not.toHaveBeenCalled();
  });

  it('coerces a truthy non-boolean payload to true', () => {
    expect(ipcHandlers['ssl:set-trust'](null, 1)).toBe(true);
    const event = { preventDefault: vi.fn() };
    const callback = vi.fn();
    appOnHandlers['certificate-error'](event, null, 'https://x', 'err', {}, callback);
    expect(event.preventDefault).toHaveBeenCalled();

    // Reset to the safe default for subsequent tests.
    ipcHandlers['ssl:set-trust'](null, false);
  });

  it('gates the main-process net stack (session cert verify proc) on the same flag', () => {
    expect(mockSetCertificateVerifyProc).toHaveBeenCalledTimes(1);
    const verifyProc = mockSetCertificateVerifyProc.mock.calls[0][0] as (
      request: unknown,
      callback: (code: number) => void
    ) => void;

    ipcHandlers['ssl:set-trust'](null, true);
    const trustCallback = vi.fn();
    verifyProc({}, trustCallback);
    expect(trustCallback).toHaveBeenCalledWith(0);

    ipcHandlers['ssl:set-trust'](null, false);
    const rejectCallback = vi.fn();
    verifyProc({}, rejectCallback);
    expect(rejectCallback).toHaveBeenCalledWith(-3);
  });
});

describe('secure:available / secure:encrypt / secure:decrypt', () => {
  it('reports encryption availability from safeStorage', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValueOnce(true);
    expect(ipcHandlers['secure:available'](null)).toBe(true);

    mockSafeStorage.isEncryptionAvailable.mockReturnValueOnce(false);
    expect(ipcHandlers['secure:available'](null)).toBe(false);
  });

  it('returns null instead of throwing when isEncryptionAvailable() throws', () => {
    mockSafeStorage.isEncryptionAvailable.mockImplementationOnce(() => {
      throw new Error('keychain locked');
    });
    expect(ipcHandlers['secure:available'](null)).toBe(false);
  });

  it('round-trips a plaintext string through encrypt/decrypt', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
    const encrypted = ipcHandlers['secure:encrypt'](null, 'super-secret-password') as string;
    expect(typeof encrypted).toBe('string');

    const decrypted = ipcHandlers['secure:decrypt'](null, encrypted);
    expect(decrypted).toBe('super-secret-password');
  });

  it('encrypt() returns null for a non-string plaintext', () => {
    expect(ipcHandlers['secure:encrypt'](null, 12345)).toBeNull();
    expect(ipcHandlers['secure:encrypt'](null, undefined)).toBeNull();
  });

  it('encrypt() returns null when encryption is unavailable', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
    expect(ipcHandlers['secure:encrypt'](null, 'secret')).toBeNull();
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
  });

  it('encrypt() returns null instead of throwing when safeStorage.encryptString throws', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
    mockSafeStorage.encryptString.mockImplementationOnce(() => {
      throw new Error('OS keychain denied access');
    });
    expect(ipcHandlers['secure:encrypt'](null, 'secret')).toBeNull();
  });

  it('decrypt() returns null for a non-string payload', () => {
    expect(ipcHandlers['secure:decrypt'](null, 12345)).toBeNull();
  });

  it('decrypt() returns null when encryption is unavailable', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
    expect(ipcHandlers['secure:decrypt'](null, 'AAAA')).toBeNull();
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
  });

  it('decrypt() returns null instead of throwing on malformed/undecryptable input', () => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
    mockSafeStorage.decryptString.mockImplementationOnce(() => {
      throw new Error('bad ciphertext');
    });
    expect(ipcHandlers['secure:decrypt'](null, 'not-real-ciphertext')).toBeNull();
  });
});

describe('app lifecycle wiring', () => {
  it('sets the max-connections-per-host command line switch before startup', () => {
    expect(mockAppendSwitch).toHaveBeenCalledWith('max-connections-per-host', '32');
  });

  it('creates a BrowserWindow once whenReady resolves', () => {
    expect(browserWindowInstances.length).toBeGreaterThanOrEqual(1);
  });

  it('quits on window-all-closed for non-macOS platforms', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      appOnHandlers['window-all-closed']();
      expect(mockAppQuit).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('does not quit on window-all-closed for macOS (dock icon stays)', () => {
    mockAppQuit.mockClear();
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      appOnHandlers['window-all-closed']();
      expect(mockAppQuit).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});

// A second instance on the same userData fails to open Chromium's localStorage
// LevelDB (the first holds its lock), and Chromium then deletes and recreates
// it, wiping every saved setting (refs #572).
describe('single instance', () => {
  it('brings the running window to the front when a second instance starts', () => {
    const win = makeFakeBrowserWindow();
    fakeElectron.BrowserWindow.getAllWindows.mockReturnValueOnce([win]);

    appOnHandlers['second-instance']();

    expect(win.restore).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  // Last in the file: it loads main.cjs a second time, re-registering handlers.
  it('quits without opening a window when another instance holds the lock', async () => {
    mockRequestSingleInstanceLock.mockReturnValueOnce(false);
    mockAppQuit.mockClear();
    const windowsBefore = browserWindowInstances.length;
    delete (require.cache as Record<string, unknown>)[require.resolve('../main.cjs')];

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../main.cjs');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockAppQuit).toHaveBeenCalled();
    expect(browserWindowInstances.length).toBe(windowsBefore);
  });
});
