/**
 * Unit tests for HTTP client (security-critical)
 *
 * Tests for the unified HTTP client including:
 * - Platform detection (Native/Tauri/Web/Proxy)
 * - Token injection via HttpOptions
 * - Error handling and HttpError creation
 * - Blob handling on native platforms
 * - Query parameter encoding
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
  httpRequest,
  httpGet,
  httpPost,
  httpPut,
  httpDelete,
  type HttpError,
} from '../http';
import { Platform } from '../platform';
import { log, LogLevel } from '../logger';

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: {
    request: vi.fn(),
  },
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

vi.mock('../platform', () => ({
  Platform: {
    isNative: false,
    isTauri: false,
    isWeb: true,
    isDev: false,
    shouldUseProxy: false,
  },
}));

vi.mock('../logger', () => ({
  log: {
    api: vi.fn(),
    error: vi.fn(),
    http: vi.fn(),
    groupCollapsed: vi.fn(),
  },
  LogLevel: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4,
  },
}));

describe('HTTP Client - Web Platform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('httpRequest - Basic Operations', () => {
    it('makes GET request with fetch', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ data: 'test' }),
        text: vi.fn().mockResolvedValue('{"data":"test"}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const result = await httpRequest('https://example.com/api/data');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/api/data',
        expect.objectContaining({
          method: 'GET',
          headers: {},
        })
      );
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ data: 'test' });
    });

    it('makes POST request with JSON body', async () => {
      const mockResponse = {
        ok: true,
        status: 201,
        statusText: 'Created',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: vi.fn().mockResolvedValue('{"id":123}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const body = { name: 'Test', value: 42 };
      const result = await httpRequest('https://example.com/api/create', {
        method: 'POST',
        body,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/api/create',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      );
      expect(result.status).toBe(201);
    });

    it('adds token to query parameters', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('{"success":true}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      await httpRequest('https://example.com/api/data', {
        token: 'secret-token-123',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/api/data?token=secret-token-123',
        expect.anything()
      );
    });

    it('adds query parameters to URL', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('{}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      await httpRequest('https://example.com/api/data', {
        params: { page: '1', limit: '10', filter: 'active' },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/api/data?page=1&limit=10&filter=active',
        expect.anything()
      );
    });

    it('combines existing query string with new parameters', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('{}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      await httpRequest('https://example.com/api/data?existing=param', {
        params: { new: 'value' },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/api/data?existing=param&new=value',
        expect.anything()
      );
    });

    it('combines token with existing parameters', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('{}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      await httpRequest('https://example.com/api/data', {
        params: { page: '1' },
        token: 'token123',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/api/data?page=1&token=token123',
        expect.anything()
      );
    });
  });

  describe('Response Type Handling', () => {
    it('handles JSON response type', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('{"result":"success"}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const result = await httpRequest('https://example.com/api/data', {
        responseType: 'json',
      });

      expect(result.data).toEqual({ result: 'success' });
    });

    it('handles blob response type', async () => {
      const mockBuffer = new Uint8Array([1, 2, 3]).buffer;
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: vi.fn().mockResolvedValue(mockBuffer),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const result = await httpRequest('https://example.com/api/image', {
        responseType: 'blob',
      });

      expect(result.data).toBeInstanceOf(Blob);
      expect((result.data as Blob).type).toBe('image/png');
    });

    it('handles arraybuffer response type', async () => {
      const mockBuffer = new ArrayBuffer(8);
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        arrayBuffer: vi.fn().mockResolvedValue(mockBuffer),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const result = await httpRequest('https://example.com/api/binary', {
        responseType: 'arraybuffer',
      });

      expect(result.data).toBe(mockBuffer);
    });

    it('handles text response type', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('plain text response'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const result = await httpRequest('https://example.com/api/text', {
        responseType: 'text',
      });

      expect(result.data).toBe('plain text response');
    });

    it('parses JSON by default when responseType not specified', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('{"auto":"parse"}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const result = await httpRequest('https://example.com/api/data');

      expect(result.data).toEqual({ auto: 'parse' });
    });

    it('returns text when JSON parsing fails', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('not valid json'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const result = await httpRequest('https://example.com/api/data');

      expect(result.data).toBe('not valid json');
    });
  });

  describe('Error Handling', () => {
    it('throws HttpError on failed request', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('{"error":"Resource not found"}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      try {
        await httpRequest('https://example.com/api/missing');
        expect.fail('Should have thrown error');
      } catch (error) {
        const httpError = error as HttpError;
        expect(httpError.status).toBe(404);
        expect(httpError.statusText).toBe('Not Found');
        expect(httpError.message).toContain('404');
      }
    });

    it('respects validateStatus overrides', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('{"error":"Unauthorized"}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const result = await httpRequest('https://example.com/api/protected', {
        validateStatus: (status) => status === 401,
      });

      expect(result.status).toBe(401);
    });

    it('includes response data in error', async () => {
      const errorData = { error: 'Unauthorized', code: 401 };
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue(JSON.stringify(errorData)),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      try {
        await httpRequest('https://example.com/api/protected');
        expect.fail('Should have thrown error');
      } catch (error) {
        const httpError = error as HttpError;
        expect(httpError.data).toEqual(errorData);
      }
    });

    it('includes response headers in error', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({
          'x-error-code': 'SERVER_ERROR',
          'content-type': 'application/json',
        }),
        text: vi.fn().mockResolvedValue('{}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      try {
        await httpRequest('https://example.com/api/error');
        expect.fail('Should have thrown error');
      } catch (error) {
        const httpError = error as HttpError;
        expect(httpError.headers['x-error-code']).toBe('SERVER_ERROR');
        expect(httpError.headers['content-type']).toBe('application/json');
      }
    });

    it('handles network errors', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      await expect(
        httpRequest('https://example.com/api/data')
      ).rejects.toThrow('Network error');
    });
  });

  describe('Custom Headers', () => {
    it('includes custom headers in request', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('{}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      await httpRequest('https://example.com/api/data', {
        headers: {
          'X-Custom-Header': 'custom-value',
          'Authorization': 'Bearer token123',
        },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/api/data',
        expect.objectContaining({
          headers: {
            'X-Custom-Header': 'custom-value',
            'Authorization': 'Bearer token123',
          },
        })
      );
    });

    it('sets Content-Type for JSON body', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('{}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      await httpRequest('https://example.com/api/data', {
        method: 'POST',
        body: { key: 'value' },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/api/data',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('preserves existing Content-Type header', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('{}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      await httpRequest('https://example.com/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: { key: 'value' },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/api/data',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/xml' },
        })
      );
    });
  });

  describe('Body Handling', () => {
    it('handles string body', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('{}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      await httpRequest('https://example.com/api/data', {
        method: 'POST',
        body: 'plain text body',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/api/data',
        expect.objectContaining({
          body: 'plain text body',
        })
      );
    });

    it('handles URLSearchParams body', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('{}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const params = new URLSearchParams({ key1: 'value1', key2: 'value2' });
      await httpRequest('https://example.com/api/data', {
        method: 'POST',
        body: params,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/api/data',
        expect.objectContaining({
          body: params.toString(),
        })
      );
    });

    it('handles object body (JSON serialization)', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('{}'),
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const body = { nested: { data: [1, 2, 3] } };
      await httpRequest('https://example.com/api/data', {
        method: 'POST',
        body,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/api/data',
        expect.objectContaining({
          body: JSON.stringify(body),
        })
      );
    });
  });
});

describe('HTTP Client - Native Platform', () => {
  let capacitorHttp: { request: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.defineProperty(Platform, 'isNative', { value: true, writable: true });
    Object.defineProperty(Platform, 'isWeb', { value: false, writable: true });
    const module = await import('@capacitor/core');
    capacitorHttp = module.CapacitorHttp as unknown as { request: ReturnType<typeof vi.fn> };
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'isNative', { value: false, writable: true });
    Object.defineProperty(Platform, 'isWeb', { value: true, writable: true });
  });

  it('uses CapacitorHttp for native requests', async () => {
    const mockResponse = {
      url: 'https://example.com/api/data',
      status: 200,
      data: { result: 'success' },
      headers: { 'content-type': 'application/json' },
    };

    vi.mocked(capacitorHttp.request).mockResolvedValue(mockResponse);

    const result = await httpRequest('https://example.com/api/data');

    expect(capacitorHttp.request).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://example.com/api/data',
      headers: {},
      data: undefined,
      responseType: undefined,
    });
    expect(result.data).toEqual({ result: 'success' });
  });

  it('returns base64 string for blob response on native', async () => {
    const base64Data = btoa('image binary data');
    const mockResponse = {
      url: 'https://example.com/api/image',
      status: 200,
      data: base64Data,
      headers: { 'content-type': 'image/png' },
    };

    vi.mocked(capacitorHttp.request).mockResolvedValue(mockResponse);

    const result = await httpRequest('https://example.com/api/image', {
      responseType: 'blob',
    });

    expect(result.data).toBe(base64Data);
  });

  it('returns base64 string when content-type is missing', async () => {
    const base64Data = btoa('binary data');
    const mockResponse = {
      url: 'https://example.com/api/file',
      status: 200,
      data: base64Data,
      headers: {},
    };

    vi.mocked(capacitorHttp.request).mockResolvedValue(mockResponse);

    const result = await httpRequest('https://example.com/api/file', {
      responseType: 'blob',
    });

    expect(result.data).toBe(base64Data);
  });

  it('throws HttpError for failed native request', async () => {
    const mockResponse = {
      url: 'https://example.com/api/missing',
      status: 404,
      data: { error: 'Not found' },
      headers: {},
    };

    vi.mocked(capacitorHttp.request).mockResolvedValue(mockResponse);

    try {
      await httpRequest('https://example.com/api/missing');
      expect.fail('Should have thrown error');
    } catch (error) {
      const httpError = error as HttpError;
      expect(httpError.status).toBe(404);
    }
  });
});

describe('HTTP Client - Tauri Platform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(Platform, 'isTauri', { value: true, writable: true });
    Object.defineProperty(Platform, 'isNative', { value: false, writable: true });
    Object.defineProperty(Platform, 'isWeb', { value: false, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'isTauri', { value: false, writable: true });
    Object.defineProperty(Platform, 'isWeb', { value: true, writable: true });
  });

  it('uses tauriFetch for Tauri requests', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: vi.fn().mockResolvedValue('{"data":"tauri"}'),
    };

    vi.mocked(tauriFetch).mockResolvedValue(mockResponse as any);

    const result = await httpRequest('https://example.com/api/data');

    expect(tauriFetch).toHaveBeenCalledWith(
      'https://example.com/api/data',
      expect.objectContaining({
        method: 'GET',
        headers: {},
      })
    );
    expect(result.data).toEqual({ data: 'tauri' });
  });

  it('throws HttpError for failed Tauri request', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('{}'),
    };

    vi.mocked(tauriFetch).mockResolvedValue(mockResponse as any);

    try {
      await httpRequest('https://example.com/api/error');
      expect.fail('Should have thrown error');
    } catch (error) {
      const httpError = error as HttpError;
      expect(httpError.status).toBe(500);
      expect(httpError.statusText).toBe('Internal Server Error');
    }
  });
});

describe('HTTP Client - Proxy Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    Object.defineProperty(Platform, 'shouldUseProxy', { value: true, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'shouldUseProxy', { value: false, writable: true });
    vi.restoreAllMocks();
  });

  it('routes requests through proxy in dev mode', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('{}'),
    };

    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

    await httpRequest('https://example.com/api/data');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/proxy/api/data',
      expect.objectContaining({
        headers: {
          'X-Target-Host': 'https://example.com',
        },
      })
    );
  });

  it('preserves query parameters through proxy', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('{}'),
    };

    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

    await httpRequest('https://example.com/api/data?param=value');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/proxy/api/data?param=value',
      expect.anything()
    );
  });

  it('adds X-Target-Host header for proxy', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('{}'),
    };

    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

    await httpRequest('https://zoneminder.example.com:8443/zm/api/data', {
      headers: { 'Custom': 'header' },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          'Custom': 'header',
          'X-Target-Host': 'https://zoneminder.example.com:8443',
        },
      })
    );
  });
});

describe('Convenience Methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('httpGet makes GET request', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('{"data":"test"}'),
    };

    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

    await httpGet('https://example.com/api/data');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/api/data',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('httpPost makes POST request with body', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('{}'),
    };

    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

    await httpPost('https://example.com/api/create', { name: 'test' });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/api/create',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
      })
    );
  });

  it('httpPut makes PUT request with body', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('{}'),
    };

    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

    await httpPut('https://example.com/api/update/1', { name: 'updated' });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/api/update/1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ name: 'updated' }),
      })
    );
  });

  it('httpDelete makes DELETE request', async () => {
    const mockResponse = {
      ok: true,
      status: 204,
      statusText: 'No Content',
      headers: new Headers(),
      text: vi.fn().mockResolvedValue(''),
    };

    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

    await httpDelete('https://example.com/api/delete/1');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/api/delete/1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('HTTP Client - cancellation logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a caller-aborted request at DEBUG (cancelled), not ERROR, and still rejects', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.mocked(global.fetch).mockRejectedValue(
      new DOMException('The operation was aborted.', 'AbortError')
    );

    await expect(
      httpRequest('https://example.com/zm/cgi-bin/nph-zms', { signal: controller.signal })
    ).rejects.toBeTruthy();

    const groupCollapsed = vi.mocked(log.groupCollapsed);
    expect(groupCollapsed).toHaveBeenCalled();
    const [, headline, level] = groupCollapsed.mock.calls[groupCollapsed.mock.calls.length - 1];
    expect(headline).toContain('cancelled');
    expect(level).toBe(LogLevel.DEBUG);
  });

  it('logs a genuine failure at ERROR', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('network down'));

    await expect(httpRequest('https://example.com/api/data')).rejects.toBeTruthy();

    const groupCollapsed = vi.mocked(log.groupCollapsed);
    const [, headline, level] = groupCollapsed.mock.calls[groupCollapsed.mock.calls.length - 1];
    expect(headline).toContain('✗');
    expect(level).toBe(LogLevel.ERROR);
  });

  it('emits no HTTP log when suppressLog is set, on success or failure', async () => {
    const okResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/octet-stream' }),
      body: null,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
    };
    vi.mocked(global.fetch).mockResolvedValue(okResponse as any);
    await httpRequest('https://example.com/frame', { responseType: 'blob', suppressLog: true });
    expect(vi.mocked(log.groupCollapsed)).not.toHaveBeenCalled();

    vi.mocked(global.fetch).mockRejectedValue(new Error('boom'));
    await expect(
      httpRequest('https://example.com/frame', { suppressLog: true })
    ).rejects.toBeTruthy();
    expect(vi.mocked(log.groupCollapsed)).not.toHaveBeenCalled();
  });
});
