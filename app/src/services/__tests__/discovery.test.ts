/**
 * Discovery System Tests
 *
 * Tests for ZoneMinder endpoint discovery.
 * The discovery logic probes for the API and derives portal/CGI URLs from it.
 * If credentials are provided, it authenticates and fetches ZM_PATH_ZMS for accurate cgiUrl.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { discoverZoneminder, DiscoveryError } from '../discovery';
import type { ApiClient } from '../../api/client';

vi.mock('../../api/store-gates', () => ({
  createStoreApiClient: vi.fn((_baseURL: string) => {
    return {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as ApiClient;
  }),
}));

// Mock auth functions (fetchZmsPath is no longer used directly in discovery)
vi.mock('../../api/auth', () => ({
  fetchZmsPath: vi.fn(),
}));

// Mock logger
vi.mock('../../lib/logger', () => ({
  log: {
    discovery: vi.fn(),
    http: vi.fn(),
  },
  LogLevel: {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
  },
}));

// The stream-path probe goes through lib/http; each test scripts its answers.
const httpGet = vi.fn();
vi.mock('../../lib/http', () => ({ httpGet: (...args: unknown[]) => httpGet(...args) }));

// Import after mocks
import { createStoreApiClient } from '../../api/store-gates';

describe('discoverZoneminder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Success cases', () => {
    it('discovers ZoneMinder with /zm/api path and derives correct URLs', async () => {
      const mockGet = vi.fn()
        .mockResolvedValueOnce({ status: 200, data: { version: '1.36.0' } });

      (createStoreApiClient as any).mockReturnValue({ get: mockGet });

      const result = await discoverZoneminder('http://zm.example.com');

      // portalUrl = apiUrl minus "/api", cgiUrl = portalUrl + /cgi-bin/nph-zms (default)
      expect(result).toEqual({
        portalUrl: 'http://zm.example.com/zm',
        apiUrl: 'http://zm.example.com/zm/api',
        cgiUrl: 'http://zm.example.com/zm/cgi-bin/nph-zms',
        cgiUrlSource: 'default',
      });
    });

    it('discovers ZoneMinder with /api path (no /zm prefix)', async () => {
      const mockGet = vi.fn()
        // API check for /zm/api - fails (connection error, login.json fallback skipped)
        .mockRejectedValueOnce(new Error('Not found'))
        // API check for /api - success
        .mockResolvedValueOnce({ status: 200, data: { version: '1.36.0' } });

      (createStoreApiClient as any).mockReturnValue({ get: mockGet });

      const result = await discoverZoneminder('http://zm.example.com');

      expect(result).toEqual({
        portalUrl: 'http://zm.example.com',
        apiUrl: 'http://zm.example.com/api',
        cgiUrl: 'http://zm.example.com/cgi-bin/nph-zms',
        cgiUrlSource: 'default',
      });
    });

    it('fetches ZM_PATH_ZMS when credentials provided', async () => {
      const mockGet = vi.fn()
        // API probe
        .mockResolvedValueOnce({ status: 200, data: { version: '1.36.0' } })
        // ZMS config fetch
        .mockResolvedValueOnce({ status: 200, data: { config: { Value: '/zm/cgi-bin/nph-zms' } } });
      const mockPost = vi.fn()
        // Login
        .mockResolvedValueOnce({ status: 200, data: { access_token: 'token' } });

      (createStoreApiClient as any).mockReturnValue({ get: mockGet, post: mockPost });

      const result = await discoverZoneminder('http://zm.example.com', {
        username: 'admin',
        password: 'secret',
      });

      expect(mockPost).toHaveBeenCalled();
      expect(result.cgiUrl).toBe('http://zm.example.com/zm/cgi-bin/nph-zms');
    });

    it('uses server ZMS path even if different from default', async () => {
      const mockGet = vi.fn()
        // API probe
        .mockResolvedValueOnce({ status: 200, data: { version: '1.36.0' } })
        // ZMS config fetch with non-standard path
        .mockResolvedValueOnce({ status: 200, data: { config: { Value: '/custom/path/nph-zms' } } });
      const mockPost = vi.fn()
        .mockResolvedValueOnce({ status: 200, data: { access_token: 'token' } });

      (createStoreApiClient as any).mockReturnValue({ get: mockGet, post: mockPost });

      const result = await discoverZoneminder('http://zm.example.com', {
        username: 'admin',
        password: 'secret',
      });

      expect(result.cgiUrl).toBe('http://zm.example.com/custom/path/nph-zms');
      expect(result.cgiUrlSource).toBe('server');
    });

    it('falls back to default cgiUrl if auth fails', async () => {
      const mockGet = vi.fn()
        .mockResolvedValueOnce({ status: 200, data: { version: '1.36.0' } });
      const mockPost = vi.fn()
        .mockRejectedValueOnce(new Error('Invalid credentials'));

      (createStoreApiClient as any).mockReturnValue({ get: mockGet, post: mockPost });

      const result = await discoverZoneminder('http://zm.example.com', {
        username: 'admin',
        password: 'wrong',
      });

      // Should still succeed with default cgiUrl
      expect(result.cgiUrl).toBe('http://zm.example.com/zm/cgi-bin/nph-zms');
      expect(result.cgiUrlSource).toBe('default');
    });

    it('handles HTTPS URLs correctly', async () => {
      const mockGet = vi.fn()
        .mockResolvedValueOnce({ status: 200, data: { version: '1.36.0' } });

      (createStoreApiClient as any).mockReturnValue({ get: mockGet });

      const result = await discoverZoneminder('https://zm.example.com');

      expect(result.portalUrl).toBe('https://zm.example.com/zm');
      expect(result.apiUrl).toContain('https://');
      expect(result.cgiUrl).toContain('https://');
    });

    it('adds https:// prefix to scheme-less URLs and tries HTTPS first', async () => {
      const mockGet = vi.fn()
        .mockResolvedValueOnce({ status: 200, data: { version: '1.36.0' } });

      (createStoreApiClient as any).mockReturnValue({ get: mockGet });

      const result = await discoverZoneminder('zm.example.com');

      // Should try HTTPS first
      expect(result.portalUrl).toMatch(/^https:\/\//);
    });

    it('falls back to HTTP if HTTPS fails', async () => {
      const mockGet = vi.fn()
        // HTTPS /zm/api - fails (connection error, login.json fallback skipped)
        .mockRejectedValueOnce(new Error('Connection refused'))
        // HTTPS /api - fails (connection error, login.json fallback skipped)
        .mockRejectedValueOnce(new Error('Connection refused'))
        // HTTP /zm/api - success
        .mockResolvedValueOnce({ status: 200, data: { version: '1.36.0' } });

      (createStoreApiClient as any).mockReturnValue({ get: mockGet });

      const result = await discoverZoneminder('zm.example.com');

      expect(result.portalUrl).toMatch(/^http:\/\//);
    });

    it('accepts 401 as valid API response (auth required)', async () => {
      const mockGet = vi.fn()
        .mockRejectedValueOnce({ status: 401, message: 'Unauthorized' });

      (createStoreApiClient as any).mockReturnValue({ get: mockGet });

      const result = await discoverZoneminder('http://zm.example.com');

      expect(result.apiUrl).toBe('http://zm.example.com/zm/api');
    });
  });

  describe('Error cases', () => {
    it('throws DiscoveryError when API is not found at any path', async () => {
      const mockGet = vi.fn()
        .mockRejectedValue(new Error('Not found'));

      (createStoreApiClient as any).mockReturnValue({ get: mockGet });

      await expect(discoverZoneminder('http://nonexistent.com')).rejects.toThrow(
        DiscoveryError
      );
    });

    it('throws with API_NOT_FOUND code when no API is discovered', async () => {
      const mockGet = vi.fn()
        .mockRejectedValue(new Error('Connection refused'));

      (createStoreApiClient as any).mockReturnValue({ get: mockGet });

      try {
        await discoverZoneminder('http://zm.example.com');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DiscoveryError);
        expect((error as DiscoveryError).code).toBe('API_NOT_FOUND');
      }
    });
  });

  describe('Edge cases', () => {
    it('handles URLs with trailing slashes', async () => {
      const mockGet = vi.fn()
        .mockResolvedValueOnce({ status: 200, data: { version: '1.36.0' } });

      (createStoreApiClient as any).mockReturnValue({ get: mockGet });

      const result = await discoverZoneminder('http://zm.example.com/');

      // Check that paths don't have double slashes (after the protocol)
      const pathPart = result.portalUrl.replace(/^https?:\/\//, '');
      expect(pathPart).not.toContain('//');
    });

    it('handles URLs with ports', async () => {
      const mockGet = vi.fn()
        .mockResolvedValueOnce({ status: 200, data: { version: '1.36.0' } });

      (createStoreApiClient as any).mockReturnValue({ get: mockGet });

      const result = await discoverZoneminder('http://zm.example.com:8080');

      expect(result.portalUrl).toBe('http://zm.example.com:8080/zm');
      expect(result.apiUrl).toContain(':8080');
      expect(result.cgiUrl).toContain(':8080');
    });

    it('handles hostnames without domain', async () => {
      const mockGet = vi.fn()
        .mockResolvedValueOnce({ status: 200, data: { version: '1.36.0' } });

      (createStoreApiClient as any).mockReturnValue({ get: mockGet });

      const result = await discoverZoneminder('http://zm-server');

      expect(result.portalUrl).toBe('http://zm-server/zm');
    });

    it('uses login.json fallback when getVersion.json fails', async () => {
      const mockGet = vi.fn()
        // getVersion.json fails with 404
        .mockRejectedValueOnce({ status: 404, message: 'Not found' })
        // login.json succeeds
        .mockResolvedValueOnce({ status: 200 });

      (createStoreApiClient as any).mockReturnValue({ get: mockGet });

      const result = await discoverZoneminder('http://zm.example.com');

      expect(result.apiUrl).toBe('http://zm.example.com/zm/api');
    });

    // A server with auth off serves its config without a token (refs #613).
    it('reads ZM_PATH_ZMS without logging in when no credentials are given', async () => {
      const mockGet = vi.fn()
        .mockResolvedValueOnce({ status: 200, data: { version: '1.36.0' } })
        .mockResolvedValueOnce({ status: 200, data: { config: { Value: '/custom/nph-zms' } } });
      const mockPost = vi.fn();

      (createStoreApiClient as any).mockReturnValue({ get: mockGet, post: mockPost });

      const result = await discoverZoneminder('http://zm.example.com');

      expect(mockPost).not.toHaveBeenCalled();
      expect(mockGet.mock.calls[1][0]).toBe('/configs/viewByName/ZM_PATH_ZMS.json');
      expect(result.cgiUrl).toBe('http://zm.example.com/custom/nph-zms');
      expect(result.cgiUrlSource).toBe('server');
    });

    it('throws CANCELLED error when signal is already aborted', async () => {
      const abortController = new AbortController();
      abortController.abort();

      await expect(
        discoverZoneminder('http://zm.example.com', { signal: abortController.signal })
      ).rejects.toThrow(DiscoveryError);

      try {
        await discoverZoneminder('http://zm.example.com', { signal: abortController.signal });
      } catch (error) {
        expect((error as DiscoveryError).code).toBe('CANCELLED');
      }
    });

    it('throws CANCELLED error when signal is aborted during probe', async () => {
      const abortController = new AbortController();

      const mockGet = vi.fn().mockImplementation(() => {
        // Simulate abort during request
        abortController.abort();
        const error = new Error('aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      (createStoreApiClient as any).mockReturnValue({ get: mockGet });

      await expect(
        discoverZoneminder('http://zm.example.com', { signal: abortController.signal })
      ).rejects.toThrow(DiscoveryError);

      try {
        await discoverZoneminder('http://zm.example.com', { signal: abortController.signal });
      } catch (error) {
        expect((error as DiscoveryError).code).toBe('CANCELLED');
      }
    });
  });
});

/**
 * Discovery logs in to read ZM_PATH_ZMS, then threw the token away, and the
 * add-server form logged in again for the same credentials 600ms later:
 * ZoneMinder's login.json hashes the password server-side and is 20x slower
 * than any other endpoint. The login discovery already did is now part of
 * its result, so a caller that holds it can skip its own.
 */
describe('discovery returns the login it performed', () => {
  it('carries the validated login response alongside the URLs', async () => {
    const mockGet = vi.fn()
      .mockResolvedValueOnce({ status: 200, data: { version: '1.36.0' } })          // getVersion probe
      .mockResolvedValueOnce({ status: 200, data: { config: { Value: '/zm/cgi-bin/nph-zms' } } }); // ZM_PATH_ZMS
    const mockPost = vi.fn().mockResolvedValueOnce({
      status: 200,
      data: { access_token: 'tok', access_token_expires: 3600, refresh_token: 'ref', refresh_token_expires: 86400, version: '1.36.0', apiversion: '2.0' },
    });
    vi.mocked(createStoreApiClient).mockReturnValue({ get: mockGet, post: mockPost } as unknown as ApiClient);

    const result = await discoverZoneminder('http://zm.example.com', { username: 'admin', password: 'pw' });

    expect(result.cgiUrl).toBe('http://zm.example.com/zm/cgi-bin/nph-zms');
    expect(result.loginResponse?.access_token).toBe('tok');
    expect(result.loginResponse?.refresh_token).toBe('ref');
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('omits the login when the server answered without tokens', async () => {
    const mockGet = vi.fn().mockResolvedValueOnce({ status: 200, data: { version: '1.36.0' } });
    const mockPost = vi.fn().mockResolvedValueOnce({ status: 200, data: {} });
    vi.mocked(createStoreApiClient).mockReturnValue({ get: mockGet, post: mockPost } as unknown as ApiClient);

    const result = await discoverZoneminder('http://zm.example.com', { username: 'admin', password: 'pw' });

    expect(result.loginResponse).toBeUndefined();
    expect(result.cgiUrl).toBe('http://zm.example.com/zm/cgi-bin/nph-zms');
  });
});

/**
 * Discovery asks each streaming URL candidate for one frame, the server's
 * ZM_PATH_ZMS first and `<portal>/cgi-bin/nph-zms` second, and keeps the
 * first that returns an image (refs #613).
 */
describe('discovery checks the streaming URL with a frame', () => {
  const monitors = { monitors: [{ Monitor: { Id: '4', Capturing: 'Always' } }] };
  const image = { status: 200, statusText: '', data: '', headers: { 'content-type': 'image/jpeg' } };
  const notFound = { status: 404, statusText: '', data: '', headers: { 'content-type': 'text/html' } };

  function serverWith(zmsPath: string, monitorList: unknown = monitors) {
    const mockGet = vi.fn()
      .mockResolvedValueOnce({ status: 200, data: { version: '1.36.0' } })
      .mockResolvedValueOnce({ status: 200, data: { config: { Value: zmsPath } } })
      .mockResolvedValueOnce({ status: 200, data: monitorList });
    const mockPost = vi.fn().mockResolvedValueOnce({ status: 200, data: { access_token: 'tok' } });
    vi.mocked(createStoreApiClient).mockReturnValue({ get: mockGet, post: mockPost } as unknown as ApiClient);
  }
  const probed = () => httpGet.mock.calls.map(([url]) => String(url).split('?')[0]);
  const creds = { username: 'admin', password: 'pw' };

  beforeEach(() => { httpGet.mockReset(); });

  it('keeps the server-reported URL when it returns a frame', async () => {
    serverWith('/proxied/nph-zms');
    httpGet.mockResolvedValue(image);

    const result = await discoverZoneminder('http://zm.example.com', creds);

    expect(result.cgiUrl).toBe('http://zm.example.com/proxied/nph-zms');
    expect(result.cgiUrlVerified).toBe(true);
    expect(probed()).toEqual(['http://zm.example.com/proxied/nph-zms']);
  });

  it('moves to <portal>/cgi-bin/nph-zms when the server-reported URL returns no frame', async () => {
    serverWith('/proxied/nph-zms');
    httpGet.mockImplementation(async (url: string) => (url.includes('/proxied/') ? notFound : image));

    const result = await discoverZoneminder('http://zm.example.com', creds);

    expect(result.cgiUrl).toBe('http://zm.example.com/zm/cgi-bin/nph-zms');
    expect(result.cgiUrlVerified).toBe(true);
  });

  it('keeps the server-reported URL, unverified, when neither returns a frame', async () => {
    serverWith('/proxied/nph-zms');
    httpGet.mockResolvedValue(notFound);

    const result = await discoverZoneminder('http://zm.example.com', creds);

    expect(result.cgiUrl).toBe('http://zm.example.com/proxied/nph-zms');
    expect(result.cgiUrlVerified).toBe(false);
    expect(probed()).toEqual(['http://zm.example.com/proxied/nph-zms', 'http://zm.example.com/zm/cgi-bin/nph-zms']);
  });

  it('checks nothing when the server has no monitor to ask for a frame', async () => {
    serverWith('/proxied/nph-zms', { monitors: [] });

    const result = await discoverZoneminder('http://zm.example.com', creds);

    expect(result.cgiUrl).toBe('http://zm.example.com/proxied/nph-zms');
    expect(result.cgiUrlVerified).toBeUndefined();
    expect(httpGet).not.toHaveBeenCalled();
  });
});
