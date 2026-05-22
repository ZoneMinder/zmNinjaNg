import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock WebSocket globally
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
  }

  send(_data: string) {
    // Mock send
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { wasClean: true }));
    }
  }

  addEventListener(event: string, handler: (e: Event) => void) {
    if (event === 'open') this.onopen = handler;
    else if (event === 'message') this.onmessage = handler as (e: MessageEvent) => void;
    else if (event === 'error') this.onerror = handler;
    else if (event === 'close') this.onclose = handler as (e: CloseEvent) => void;
  }

  removeEventListener() {
    // Mock remove
  }
}

global.WebSocket = MockWebSocket as unknown as typeof WebSocket;

// Mock Audio for notification sounds
global.AudioContext = vi.fn(() => ({
  createOscillator: vi.fn(() => ({
    connect: vi.fn(),
    frequency: { value: 0 },
    type: 'sine',
    start: vi.fn(),
    stop: vi.fn(),
  })),
  createGain: vi.fn(() => ({
    connect: vi.fn(),
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
  })),
  destination: {},
  currentTime: 0,
})) as unknown as typeof AudioContext;

// Mock canvas 2D context, toDataURL, and WebCodecs ImageDecoder for the MJPEG
// canvas render path. jsdom has no real canvas or WebCodecs; provide enough
// surface to decode/draw frames and read a snapshot without throwing.
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  drawImage: vi.fn(),
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.toDataURL = vi.fn(
  () => 'data:image/jpeg;base64,bW9jaw=='
) as unknown as typeof HTMLCanvasElement.prototype.toDataURL;
class MockImageDecoder {
  decode() {
    return Promise.resolve({ image: { displayWidth: 1280, displayHeight: 720, close: () => {} } });
  }
  close() {}
}
(global as unknown as { ImageDecoder: unknown }).ImageDecoder = MockImageDecoder;

// Mock Capacitor
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  },
  registerPlugin: () => new Proxy({}, {
    get: () => vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock Capacitor Haptics
vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: vi.fn().mockResolvedValue(undefined),
    notification: vi.fn().mockResolvedValue(undefined),
    vibrate: vi.fn().mockResolvedValue(undefined),
    selectionStart: vi.fn().mockResolvedValue(undefined),
    selectionChanged: vi.fn().mockResolvedValue(undefined),
    selectionEnd: vi.fn().mockResolvedValue(undefined),
  },
  ImpactStyle: {
    Heavy: 'Heavy',
    Medium: 'Medium',
    Light: 'Light',
  },
  NotificationType: {
    Success: 'Success',
    Warning: 'Warning',
    Error: 'Error',
  },
}));

// Mock Capacitor Network
vi.mock('@capacitor/network', () => ({
  Network: {
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    getStatus: vi.fn().mockResolvedValue({ connected: true, connectionType: 'wifi' }),
  },
}));

// Mock html5-qrcode for QR scanner tests
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue(0), // NOT_STARTED
  })),
  Html5QrcodeScannerState: {
    NOT_STARTED: 0,
    SCANNING: 1,
    PAUSED: 2,
  },
}));

// Mock SSLTrust plugin
vi.mock('../src/plugins/ssl-trust', () => ({
  SSLTrust: {
    enable: vi.fn().mockResolvedValue(undefined),
    disable: vi.fn().mockResolvedValue(undefined),
    isEnabled: vi.fn().mockResolvedValue({ enabled: false }),
    setTrustedFingerprint: vi.fn().mockResolvedValue(undefined),
    getServerCertFingerprint: vi.fn().mockResolvedValue({
      fingerprint: 'AA:BB:CC:DD:EE:FF',
      subject: 'CN=localhost',
      issuer: 'CN=localhost',
      expiry: '2027-01-01',
    }),
  },
}));

// Mock SafeArea plugin
vi.mock('../src/plugins/safe-area', () => ({
  SafeArea: {
    getInsets: vi.fn().mockResolvedValue({ top: 0, right: 0, bottom: 0, left: 0 }),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  },
}));

// Mock @capawesome/capacitor-badge for app icon badge
vi.mock('@capawesome/capacitor-badge', () => ({
  Badge: {
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue({ count: 0 }),
    clear: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock capacitor-barcode-scanner for native QR scanning tests
vi.mock('capacitor-barcode-scanner', () => ({
  BarcodeScanner: {
    scan: vi.fn().mockResolvedValue({ result: false, code: null }),
    multiScan: vi.fn().mockResolvedValue({ result: false, count: 0, codes: [] }),
  },
}));

// Mock Capacitor Filesystem
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    appendFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue({ data: '' }),
    writeFile: vi.fn().mockResolvedValue({ uri: 'file:///mock/zmninja-ng.log' }),
    getUri: vi.fn().mockResolvedValue({ uri: 'file:///mock/zmninja-ng.log' }),
    stat: vi.fn().mockResolvedValue({ size: 0, type: 'file', mtime: 0, uri: 'file:///mock/zmninja-ng.log' }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
  Directory: {
    Data: 'DATA',
    Cache: 'CACHE',
    Documents: 'DOCUMENTS',
  },
  Encoding: {
    UTF8: 'utf8',
    ASCII: 'ascii',
    UTF16: 'utf16',
  },
}));

// Mock Capacitor Share
vi.mock('@capacitor/share', () => ({
  Share: {
    share: vi.fn().mockResolvedValue({ activityType: 'mock' }),
    canShare: vi.fn().mockResolvedValue({ value: true }),
  },
}));

// Mock Tauri plugin-fs
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  readTextFile: vi.fn().mockResolvedValue(''),
  exists: vi.fn().mockResolvedValue(true),
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  BaseDirectory: {
    AppLog: 'AppLog',
    AppData: 'AppData',
    AppCache: 'AppCache',
    AppConfig: 'AppConfig',
    Download: 'Download',
    Document: 'Document',
    Desktop: 'Desktop',
    Picture: 'Picture',
    Video: 'Video',
  },
}));

// Mock Tauri plugin-opener
vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
  openPath: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

// Mock Tauri path APIs (used to resolve display path)
vi.mock('@tauri-apps/api/path', () => ({
  appLogDir: vi.fn().mockResolvedValue('/mock/applogdir'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

// Mock @aparajita/capacitor-biometric-auth
vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: {
    checkBiometry: vi.fn().mockResolvedValue({
      isAvailable: false,
      biometryType: 0,
      reason: 'Not available in test environment',
    }),
    authenticate: vi.fn().mockResolvedValue(undefined),
  },
  BiometryType: {
    none: 0,
    touchId: 1,
    faceId: 2,
    fingerprintAuthentication: 3,
    faceAuthentication: 4,
    irisAuthentication: 5,
  },
}));
