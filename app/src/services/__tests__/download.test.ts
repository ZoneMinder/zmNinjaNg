import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import {
    downloadFile,
    convertToSnapshotUrl,
    sanitizeFilename,
    downloadSnapshot,
    downloadSnapshotFromElement,
    downloadEventVideo,
} from '../download';
import { Platform } from '../../lib/platform';
import { useBackgroundTasks } from '../../stores/backgroundTasks';

const DEFAULT_HTTP_RESPONSE = {
    status: 200,
    data: 'base64_encoded_video_data',
    headers: { 'content-type': 'video/mp4' },
    statusText: 'OK',
};

// jsdom does not implement Blob object URLs. Polyfill once so the web
// download path (window.URL.createObjectURL/revokeObjectURL) can run for
// real in tests; individual tests only assert on the anchor produced from it.
if (!window.URL.createObjectURL) {
    (window.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:mock-url';
}
if (!window.URL.revokeObjectURL) {
    (window.URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
}

// Mock dependencies
vi.mock('../../lib/logger', () => ({
    log: {
        download: vi.fn(),
    },
    LogLevel: {
        INFO: 'INFO',
        ERROR: 'ERROR',
        WARN: 'WARN',
        DEBUG: 'DEBUG',
    },
}));

vi.mock('../../lib/platform', () => ({
    Platform: {
        isNative: true,
        isWeb: false,
    },
}));

vi.mock('../../lib/http', () => ({
    httpRequest: vi.fn().mockResolvedValue({
        status: 200,
        data: 'base64_encoded_video_data',
        headers: { 'content-type': 'video/mp4' },
        statusText: 'OK',
    }),
}));

vi.mock('@capacitor/filesystem', () => ({
    Filesystem: {
        writeFile: vi.fn().mockResolvedValue({ uri: 'file:///documents/test.mp4' }),
        Directory: {
            Documents: 'DOCUMENTS',
            Cache: 'CACHE',
        },
    },
    Directory: { Documents: 'DOCUMENTS', Cache: 'CACHE' }
}));

vi.mock('@capacitor-community/media', () => ({
    Media: {
        savePhoto: vi.fn(),
        saveVideo: vi.fn(),
    },
}));

describe('Mobile Download Logic', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        // Reset platform to native
        (Platform as any).isNative = true;
    });

    it('should download file using unified HTTP on mobile', async () => {
        const onProgress = vi.fn();

        // Trigger the download
        await downloadFile('http://example.com/video.mp4', 'test_video.mp4', { onProgress });

        const { httpRequest } = await import('../../lib/http');
        const { Filesystem } = await import('@capacitor/filesystem');
        const { Media } = await import('@capacitor-community/media');

        // Verify httpRequest was called
        expect(httpRequest).toHaveBeenCalledWith('http://example.com/video.mp4', {
            method: 'GET',
            responseType: 'base64',
        });

        // Verify file was written to documents with base64 data
        expect(Filesystem.writeFile).toHaveBeenCalledWith({
            path: 'test_video.mp4',
            directory: 'DOCUMENTS',
            data: 'base64_encoded_video_data',
        });

        // Verify media library save was attempted
        expect(Media.saveVideo).toHaveBeenCalledWith({
            path: 'file:///documents/test.mp4'
        });
    });
});

// Every test in this file may reconfigure the httpRequest/Filesystem mocks
// with mockImplementation/mockRejectedValueOnce. Restore spies and re-apply
// the shared defaults after each test so later describe blocks (and the
// "Mobile Download Logic" tests above, if re-run) never see leaked state.
afterEach(async () => {
    vi.restoreAllMocks();
    const { httpRequest } = await import('../../lib/http');
    const { Filesystem } = await import('@capacitor/filesystem');
    vi.mocked(httpRequest).mockResolvedValue(DEFAULT_HTTP_RESPONSE);
    vi.mocked(Filesystem.writeFile).mockResolvedValue({ uri: 'file:///documents/test.mp4' } as never);
});

describe('Mobile Download Logic - extended', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (Platform as any).isNative = true;
    });

    it('saves photo extensions to the Photo Library, not the Video Library', async () => {
        const { Media } = await import('@capacitor-community/media');
        await downloadFile('http://example.com/snap.jpg', 'snap.jpg');
        expect(Media.savePhoto).toHaveBeenCalledWith({ path: 'file:///documents/test.mp4' });
        expect(Media.saveVideo).not.toHaveBeenCalled();
    });

    it('does not touch the media library for unrecognized extensions', async () => {
        const { Media } = await import('@capacitor-community/media');
        await downloadFile('http://example.com/data.log', 'data.log');
        expect(Media.savePhoto).not.toHaveBeenCalled();
        expect(Media.saveVideo).not.toHaveBeenCalled();
    });

    it('throws and never writes to disk when the server responds with a non-200 status', async () => {
        const { httpRequest } = await import('../../lib/http');
        const { Filesystem } = await import('@capacitor/filesystem');
        vi.mocked(httpRequest).mockResolvedValueOnce({
            status: 404,
            data: '',
            headers: {},
            statusText: 'Not Found',
        });

        await expect(downloadFile('http://example.com/missing.mp4', 'missing.mp4')).rejects.toThrow(
            'Failed to download: HTTP 404'
        );
        expect(Filesystem.writeFile).not.toHaveBeenCalled();
    });

    it('propagates a Filesystem.writeFile failure', async () => {
        const { Filesystem } = await import('@capacitor/filesystem');
        vi.mocked(Filesystem.writeFile).mockRejectedValueOnce(new Error('disk full'));

        await expect(downloadFile('http://example.com/video.mp4', 'video.mp4')).rejects.toThrow('disk full');
    });

    it('swallows a Media library save failure: the file is already safely in Documents', async () => {
        const { Media } = await import('@capacitor-community/media');
        vi.mocked(Media.saveVideo).mockRejectedValueOnce(new Error('permission denied'));

        await expect(downloadFile('http://example.com/video.mp4', 'video.mp4')).resolves.toBeUndefined();
    });

    it('reports 100% progress once the base64 payload is fetched', async () => {
        const onProgress = vi.fn();
        await downloadFile('http://example.com/video.mp4', 'video.mp4', { onProgress });

        expect(onProgress).toHaveBeenCalledWith({
            loaded: 'base64_encoded_video_data'.length,
            total: 'base64_encoded_video_data'.length,
            percentage: 100,
        });
    });

    it('forwards the abort signal to httpRequest and propagates a mid-flight cancellation', async () => {
        const { httpRequest } = await import('../../lib/http');
        const { Filesystem } = await import('@capacitor/filesystem');
        const controller = new AbortController();
        // downloadFileNative awaits two dynamic imports before it ever calls
        // httpRequest, so abort the controller up front rather than racing it
        // against an addEventListener registered later.
        controller.abort();

        vi.mocked(httpRequest).mockImplementationOnce(
            (_url, opts: any) =>
                new Promise((_resolve, reject) => {
                    if (opts.signal?.aborted) {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                        return;
                    }
                    opts.signal?.addEventListener('abort', () => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    });
                })
        );

        const promise = downloadFile('http://example.com/video.mp4', 'video.mp4', { signal: controller.signal });

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(Filesystem.writeFile).not.toHaveBeenCalled();
    });
});

describe('Web Download Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (Platform as any).isNative = false;
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    it('downloads via a blob link and forwards download progress', async () => {
        const { httpRequest } = await import('../../lib/http');
        const onProgress = vi.fn();
        vi.mocked(httpRequest).mockImplementationOnce((_url, opts: any) => {
            opts.onDownloadProgress?.({ loaded: 512, total: 1024, percentage: 50 });
            return Promise.resolve({
                status: 200,
                data: new Blob(['fake-jpeg-bytes']),
                headers: {},
                statusText: 'OK',
            });
        });

        const appendChildSpy = vi.spyOn(document.body, 'appendChild');
        await downloadFile('http://zm.example.com/snapshot.jpg', 'snapshot.jpg', { onProgress });

        expect(onProgress).toHaveBeenCalledWith({ loaded: 512, total: 1024, percentage: 50 });
        const anchor = appendChildSpy.mock.calls.map((c) => c[0]).find((el) => el instanceof HTMLAnchorElement) as
            | HTMLAnchorElement
            | undefined;
        expect(anchor).toBeDefined();
        expect(anchor?.href).toBe('blob:mock-url');
        expect(anchor?.download).toBe('snapshot.jpg');
    });

    it('falls back to a direct download link on a non-cancellation error', async () => {
        const { httpRequest } = await import('../../lib/http');
        vi.mocked(httpRequest).mockRejectedValueOnce(new Error('CORS blocked'));

        const appendChildSpy = vi.spyOn(document.body, 'appendChild');
        await expect(
            downloadFile('http://zm.example.com/snapshot.jpg', 'snapshot.jpg')
        ).resolves.toBeUndefined();

        const anchor = appendChildSpy.mock.calls.map((c) => c[0]).find((el) => el instanceof HTMLAnchorElement) as
            | HTMLAnchorElement
            | undefined;
        expect(anchor).toBeDefined();
        expect(anchor?.target).toBe('_blank');
        expect(anchor?.href).toBe('http://zm.example.com/snapshot.jpg');
    });

    it('propagates a user cancellation instead of falling back to a direct download link', async () => {
        const { httpRequest } = await import('../../lib/http');
        const controller = new AbortController();
        controller.abort();
        const abortError = new DOMException('The operation was aborted.', 'AbortError');
        vi.mocked(httpRequest).mockRejectedValueOnce(abortError);

        const appendChildSpy = vi.spyOn(document.body, 'appendChild');
        await expect(
            downloadFile('http://zm.example.com/snapshot.jpg', 'snapshot.jpg', { signal: controller.signal })
        ).rejects.toBe(abortError);

        // No fallback anchor (target=_blank) should have been created for a cancelled download.
        const fallbackAnchor = appendChildSpy.mock.calls
            .map((c) => c[0])
            .find((el) => el instanceof HTMLAnchorElement && el.target === '_blank');
        expect(fallbackAnchor).toBeUndefined();
    });
});

describe('downloadSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    it('writes a data URL snapshot directly to disk on native, without an HTTP round-trip', async () => {
        (Platform as any).isNative = true;
        const { httpRequest } = await import('../../lib/http');
        const { Filesystem } = await import('@capacitor/filesystem');
        const { Media } = await import('@capacitor-community/media');

        await downloadSnapshot('data:image/jpeg;base64,QUFB', 'Front Door');

        expect(httpRequest).not.toHaveBeenCalled();
        expect(Filesystem.writeFile).toHaveBeenCalledWith(
            expect.objectContaining({ data: 'QUFB', directory: 'DOCUMENTS' })
        );
        expect(Media.savePhoto).toHaveBeenCalled();
    });

    it('downloads a data URL snapshot via an anchor link on web', async () => {
        (Platform as any).isNative = false;
        const appendChildSpy = vi.spyOn(document.body, 'appendChild');

        await downloadSnapshot('data:image/jpeg;base64,QUFB', 'Front Door');

        const anchor = appendChildSpy.mock.calls.map((c) => c[0]).find((el) => el instanceof HTMLAnchorElement) as
            | HTMLAnchorElement
            | undefined;
        expect(anchor?.href).toBe('data:image/jpeg;base64,QUFB');
        expect(anchor?.download).toMatch(/^Front_Door_.+\.jpg$/);
    });

    it('normalizes ZMS streaming params for a non-data-URL snapshot before fetching', async () => {
        (Platform as any).isNative = true;
        const { httpRequest } = await import('../../lib/http');
        const zmsUrl = 'http://zm.example.com/cgi-bin/nph-zms?monitor=3&mode=jpeg&connkey=55';

        await downloadSnapshot(zmsUrl, 'Back Yard');

        expect(httpRequest).toHaveBeenCalledWith(
            expect.stringContaining('mode=single'),
            expect.objectContaining({ method: 'GET', responseType: 'base64' })
        );
        expect(httpRequest).toHaveBeenCalledWith(
            expect.not.stringContaining('connkey'),
            expect.anything()
        );
    });
});

describe('downloadSnapshotFromElement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (Platform as any).isNative = false;
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    it('throws a clear error when the canvas context is unavailable', async () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        const { log } = await import('../../lib/logger');
        const video = document.createElement('video');

        await expect(downloadSnapshotFromElement(video, 'Front Door')).rejects.toThrow(
            'Failed to get canvas context'
        );
        expect(log.download).toHaveBeenCalledWith(
            '[Download] Failed to capture snapshot',
            'ERROR',
            expect.any(Error)
        );
    });

    it('captures a video frame to canvas and downloads the resulting snapshot', async () => {
        const drawImage = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never);
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,ZZZZ');
        const appendChildSpy = vi.spyOn(document.body, 'appendChild');

        const video = document.createElement('video');
        await downloadSnapshotFromElement(video, 'Front Door');

        expect(drawImage).toHaveBeenCalled();
        const anchor = appendChildSpy.mock.calls.map((c) => c[0]).find((el) => el instanceof HTMLAnchorElement) as
            | HTMLAnchorElement
            | undefined;
        expect(anchor?.href).toBe('data:image/jpeg;base64,ZZZZ');
    });

    it('downloads an image element data URL directly without re-encoding', async () => {
        const appendChildSpy = vi.spyOn(document.body, 'appendChild');
        const img = document.createElement('img');
        img.src = 'data:image/jpeg;base64,YYYY';

        await downloadSnapshotFromElement(img, 'Front Door');

        const anchor = appendChildSpy.mock.calls.map((c) => c[0]).find((el) => el instanceof HTMLAnchorElement) as
            | HTMLAnchorElement
            | undefined;
        expect(anchor?.href).toBe('data:image/jpeg;base64,YYYY');
    });

    it('downloads the nph-zms URL when the src is a native frame URL', async () => {
        // Native Streaming mode holds the stream outside the webview and serves
        // one frame at a time from zmframe://, which no downloader can fetch.
        // The player keeps the real stream URL on the element for this path.
        // Which URL is picked is platform-independent, so this runs the web
        // handler like the test below it.
        const { httpRequest } = await import('../../lib/http');
        vi.mocked(httpRequest).mockResolvedValueOnce({
            status: 200,
            data: new Blob(['x']),
            headers: {},
            statusText: 'OK',
        });
        const img = document.createElement('img');
        img.src = 'zmframe://frames/7/3';
        img.dataset.streamUrl = 'http://zm.example.com/cgi-bin/nph-zms?monitor=1&mode=jpeg&connkey=99';

        await downloadSnapshotFromElement(img, 'Front Door');

        expect(httpRequest).toHaveBeenCalledWith(
            expect.stringContaining('nph-zms'),
            expect.objectContaining({ method: 'GET', responseType: 'blob' })
        );
        expect(httpRequest).toHaveBeenCalledWith(
            expect.stringContaining('mode=single'),
            expect.anything()
        );
        expect(httpRequest).not.toHaveBeenCalledWith(
            expect.stringContaining('zmframe'),
            expect.anything()
        );
    });

    it('fetches a remote image element src through downloadFile', async () => {
        const { httpRequest } = await import('../../lib/http');
        vi.mocked(httpRequest).mockResolvedValueOnce({
            status: 200,
            data: new Blob(['x']),
            headers: {},
            statusText: 'OK',
        });
        const img = document.createElement('img');
        img.src = 'http://zm.example.com/cgi-bin/nph-zms?monitor=1&mode=jpeg';
        await downloadSnapshotFromElement(img, 'Front Door');

        expect(httpRequest).toHaveBeenCalledWith(
            expect.stringContaining('mode=single'),
            expect.objectContaining({ method: 'GET', responseType: 'blob' })
        );
    });
});

describe('downloadEventVideo (background task lifecycle)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useBackgroundTasks.setState({ tasks: [], drawerState: 'hidden' });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    afterEach(() => {
        useBackgroundTasks.setState({ tasks: [], drawerState: 'hidden' });
    });

    it('completes the task and records progress/file size on success (web)', async () => {
        (Platform as any).isNative = false;
        const { httpRequest } = await import('../../lib/http');
        vi.mocked(httpRequest).mockImplementationOnce((_url, opts: any) => {
            opts.onDownloadProgress?.({ loaded: 100, total: 100, percentage: 100 });
            return Promise.resolve({ status: 200, data: new Blob(['x']), headers: {}, statusText: 'OK' });
        });

        const taskId = downloadEventVideo('https://zm.example.com', '42', 'Front Door');

        await waitFor(() => {
            const task = useBackgroundTasks.getState().tasks.find((t) => t.id === taskId);
            expect(task?.status).toBe('completed');
        });

        const task = useBackgroundTasks.getState().tasks.find((t) => t.id === taskId)!;
        expect(task.progress).toBe(100);
        expect(task.metadata.fileSize).toBe(100);
    });

    it('fails the task and stores the error when the download rejects (native)', async () => {
        // Native has no direct-link fallback (that's web-only), so a genuine
        // HTTP failure propagates all the way to failTask. On web, downloadFileWeb
        // deliberately falls back to a direct download link on any non-abort
        // error, so the task there ends up 'completed' rather than 'failed' -
        // see the "falls back..." coverage in the 'Web Download Logic' suite.
        (Platform as any).isNative = true;
        const { httpRequest } = await import('../../lib/http');
        vi.mocked(httpRequest).mockRejectedValueOnce(new Error('network down'));

        const taskId = downloadEventVideo('https://zm.example.com', '42', 'Front Door');

        await waitFor(() => {
            const task = useBackgroundTasks.getState().tasks.find((t) => t.id === taskId);
            expect(task?.status).toBe('failed');
        });

        const task = useBackgroundTasks.getState().tasks.find((t) => t.id === taskId)!;
        expect(task.error?.message).toBe('network down');
    });

    it('keeps status=cancelled and does not open a fallback direct-download tab when cancelled mid-flight (web)', async () => {
        (Platform as any).isNative = false;
        const { httpRequest } = await import('../../lib/http');
        vi.mocked(httpRequest).mockImplementationOnce(
            (_url, opts: any) =>
                new Promise((_resolve, reject) => {
                    opts.signal?.addEventListener('abort', () => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    });
                })
        );
        const appendChildSpy = vi.spyOn(document.body, 'appendChild');

        const taskId = downloadEventVideo('https://zm.example.com', '42', 'Front Door');
        useBackgroundTasks.getState().cancelTask(taskId);

        await waitFor(() => {
            const task = useBackgroundTasks.getState().tasks.find((t) => t.id === taskId);
            expect(task?.status).toBe('cancelled');
        });
        // Give the rejected promise's catch handler a tick to (not) run further logic.
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(useBackgroundTasks.getState().tasks.find((t) => t.id === taskId)?.status).toBe('cancelled');
        const fallbackAnchor = appendChildSpy.mock.calls
            .map((c) => c[0])
            .find((el) => el instanceof HTMLAnchorElement && el.target === '_blank');
        expect(fallbackAnchor).toBeUndefined();
    });

    it('propagates cancellation on native and never writes the partial file to disk', async () => {
        (Platform as any).isNative = true;
        const { httpRequest } = await import('../../lib/http');
        const { Filesystem } = await import('@capacitor/filesystem');
        vi.mocked(httpRequest).mockImplementationOnce(
            (_url, opts: any) =>
                new Promise((_resolve, reject) => {
                    opts.signal?.addEventListener('abort', () => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    });
                })
        );

        const taskId = downloadEventVideo('https://zm.example.com', '42', 'Front Door');
        useBackgroundTasks.getState().cancelTask(taskId);

        await waitFor(() => {
            const task = useBackgroundTasks.getState().tasks.find((t) => t.id === taskId);
            expect(task?.status).toBe('cancelled');
        });
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(Filesystem.writeFile).not.toHaveBeenCalled();
        expect(useBackgroundTasks.getState().tasks.find((t) => t.id === taskId)?.status).toBe('cancelled');
    });
});

describe('sanitizeFilename', () => {
    it('keeps alphanumerics, hyphen and underscore', () => {
        expect(sanitizeFilename('Front_Door-2')).toBe('Front_Door-2');
    });

    it('strips path traversal sequences from server-controlled names', () => {
        expect(sanitizeFilename('../../etc/passwd')).toBe('______etc_passwd');
        expect(sanitizeFilename('..\\..\\windows')).toBe('______windows');
    });

    it('leaves no path separators or dot segments', () => {
        const result = sanitizeFilename('../../foo');
        expect(result).not.toContain('/');
        expect(result).not.toContain('..');
    });

    it('replaces spaces and unicode with underscores', () => {
        expect(sanitizeFilename('Back Yard café')).toBe('Back_Yard_caf_');
    });

    it('handles empty string', () => {
        expect(sanitizeFilename('')).toBe('');
    });
});

describe('ZMS Snapshot URL normalization', () => {
    it('removes streaming params and forces single mode', () => {
        const url = 'http://zm.example.com/cgi-bin/nph-zms?monitor=1&mode=jpeg&scale=100&maxfps=10&connkey=4456&_t=123&token=abc';
        const normalized = convertToSnapshotUrl(url);
        const parsed = new URL(normalized);

        expect(parsed.searchParams.get('mode')).toBe('single');
        expect(parsed.searchParams.get('monitor')).toBe('1');
        expect(parsed.searchParams.get('scale')).toBe('100');
        expect(parsed.searchParams.get('token')).toBe('abc');
        expect(parsed.searchParams.get('maxfps')).toBeNull();
        expect(parsed.searchParams.get('connkey')).toBeNull();
        expect(parsed.searchParams.get('_t')).toBeNull();
    });

    it('normalizes /zms URLs (without nph- prefix)', () => {
        const url = 'https://zm.example.com:30005/zm/cgi-bin/zms?monitor=5&mode=jpeg&scale=100&maxfps=10&connkey=74238&token=abc';
        const normalized = convertToSnapshotUrl(url);
        const parsed = new URL(normalized);

        expect(parsed.searchParams.get('mode')).toBe('single');
        expect(parsed.searchParams.get('monitor')).toBe('5');
        expect(parsed.searchParams.get('scale')).toBe('100');
        expect(parsed.searchParams.get('token')).toBe('abc');
        expect(parsed.searchParams.get('maxfps')).toBeNull();
        expect(parsed.searchParams.get('connkey')).toBeNull();
    });

    it('normalizes proxied ZMS URLs', () => {
        const targetUrl = 'http://zm.example.com/cgi-bin/nph-zms?monitor=2&mode=jpeg&connkey=999';
        const proxyUrl = `http://localhost:3001/image-proxy?url=${encodeURIComponent(targetUrl)}`;
        const normalized = convertToSnapshotUrl(proxyUrl);
        const parsed = new URL(normalized);
        const normalizedTarget = parsed.searchParams.get('url');

        expect(normalizedTarget).toBeTruthy();
        const targetParsed = new URL(normalizedTarget as string);
        expect(targetParsed.searchParams.get('mode')).toBe('single');
        expect(targetParsed.searchParams.get('connkey')).toBeNull();
        expect(targetParsed.searchParams.get('monitor')).toBe('2');
    });
});
