import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadFile, convertToSnapshotUrl } from '../download';
import { Platform } from '../platform';

// Mock dependencies
vi.mock('../logger', () => ({
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

vi.mock('../platform', () => ({
    Platform: {
        isNative: true,
        isWeb: false,
    },
}));

vi.mock('../http', () => ({
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

        const { httpRequest } = await import('../http');
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
