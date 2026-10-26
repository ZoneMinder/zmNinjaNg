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

// jsdom has no ResizeObserver. Provide a no-op so components that observe
// element size (ZoneOverlay, montage grid, timeline) can mount in tests.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

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

// Mock Capacitor
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  },
  registerPlugin: () => new Proxy({}, {
    get: () => vi.fn().mockResolvedValue(undefined),
  }),
  SystemBars: {
    setStyle: vi.fn().mockResolvedValue(undefined),
  },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' },
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
    setTrustedFingerprints: vi.fn().mockResolvedValue(undefined),
    getServerCertFingerprint: vi.fn().mockResolvedValue({
      fingerprint: 'AA:BB:CC:DD:EE:FF',
      subject: 'CN=localhost',
      issuer: 'CN=localhost',
      expiry: '2027-01-01',
    }),
  },
}));

// Mock NativeLlm plugin
vi.mock('../plugins/native-llm', () => ({
  NativeLlm: {
    // Device-faithful proxy trap: Capacitor's registerPlugin proxy turns ANY
    // property access into a native method call, so `await <plugin>` (promise
    // resolution probing `.then`) hangs forever on a real device with
    // '"NativeLlm.then()" is not implemented'. Throwing here makes that
    // misuse fail loudly in tests instead of passing against a plain object.
    then: () => {
      throw new Error('"NativeLlm.then()" is not implemented (never resolve a promise with the plugin proxy)');
    },
    isSupported: vi.fn().mockResolvedValue({ supported: false, reason: 'platform' }),
    isModelDownloaded: vi.fn().mockResolvedValue({ downloaded: false }),
    downloadModel: vi.fn().mockResolvedValue(undefined),
    cancelDownload: vi.fn().mockResolvedValue(undefined),
    deleteModel: vi.fn().mockResolvedValue(undefined),
    chat: vi.fn().mockResolvedValue({ content: '', promptTokens: 0, completionTokens: 0 }),
    cancelChat: vi.fn().mockResolvedValue(undefined),
    unload: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  },
}));

vi.mock('../plugins/apple-intelligence', () => ({
  AppleIntelligence: {
    // Same device-faithful proxy trap as the NativeLlm mock above: `await
    // <plugin>` must fail loudly rather than hang on a real device.
    then: () => {
      throw new Error('"AppleIntelligence.then()" is not implemented (never resolve a promise with the plugin proxy)');
    },
    isSupported: vi.fn().mockResolvedValue({ supported: false, reason: 'platform' }),
    chat: vi.fn().mockResolvedValue({ content: '' }),
    cancelChat: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock SafeArea plugin
vi.mock('../src/plugins/safe-area', () => ({
  SafeArea: {
    getInsets: vi.fn().mockResolvedValue({ top: 0, right: 0, bottom: 0, left: 0 }),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  },
}));

// Mock ZmStream plugin (keep the real URL helpers)
vi.mock('../plugins/zm-stream', async () => {
  const actual = await vi.importActual<typeof import('../plugins/zm-stream')>('../plugins/zm-stream');
  return {
    ...actual,
    ZmStream: {
      open: vi.fn().mockResolvedValue({ streamId: 'mock-stream' }),
      close: vi.fn().mockResolvedValue(undefined),
    },
  };
});

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

// Mock @capacitor-firebase/messaging for push notification tests. Declared
// globally (rather than per test file) because pushNotifications.ts performs
// several overlapping `await import('@capacitor-firebase/messaging')` calls
// the first time initialize() runs, and a per-file vi.mock factory raced one
// of those call sites into loading the real package, which then calls the
// real registerPlugin() and throws trying to reach an uninitialized Firebase
// app. See services/__tests__/pushNotifications.test.ts.
vi.mock('@capacitor-firebase/messaging', () => ({
  FirebaseMessaging: {
    requestPermissions: vi.fn().mockResolvedValue({ receive: 'granted' }),
    getToken: vi.fn().mockResolvedValue({ token: 'mock-fcm-token' }),
    createChannel: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    removeAllListeners: vi.fn().mockResolvedValue(undefined),
    deleteToken: vi.fn().mockResolvedValue(undefined),
  },
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

// Mock @mlc-ai/web-llm (on-device assistant backend, refs #246). Unit tests
// never load a real WebGPU model; this stub keeps model-download.ts and
// providers/webllm.ts testable without WebGPU. Individual test files
// override these implementations (via `vi.mocked(...).mockImplementation`)
// to exercise specific lifecycle/progress/error paths; this is only the
// shared default.
// The engine is created in a Web Worker (CreateWebWorkerMLCEngine). The mock
// returns the same engine shape; the worker's first argument is ignored.
const mockEngine = (config?: {
  initProgressCallback?: (report: { progress: number; timeElapsed: number; text: string }) => void;
}) => {
  config?.initProgressCallback?.({ progress: 1, timeElapsed: 0, text: 'done' });
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"answer":"ok"}' } }] }),
      },
    },
    unload: vi.fn().mockResolvedValue(undefined),
  };
};

vi.mock('@mlc-ai/web-llm', () => ({
  CreateMLCEngine: vi.fn().mockImplementation(async (_modelId: string, config?: Parameters<typeof mockEngine>[0]) => mockEngine(config)),
  CreateWebWorkerMLCEngine: vi.fn().mockImplementation(
    async (_worker: unknown, _modelId: string, config?: Parameters<typeof mockEngine>[0]) => mockEngine(config),
  ),
  WebWorkerMLCEngineHandler: class {},
  hasModelInCache: vi.fn().mockResolvedValue(false),
  deleteModelAllInfoInCache: vi.fn().mockResolvedValue(undefined),
  prebuiltAppConfig: { model_list: [] },
}));

// jsdom has no Worker; the engine spawns one (its module URL is never fetched
// because CreateWebWorkerMLCEngine is mocked). A stub keeps `new Worker(...)`
// from throwing in tests.
class WorkerStub {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
}
global.Worker = WorkerStub as unknown as typeof Worker;
