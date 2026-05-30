/**
 * Download Utilities
 *
 * Provides cross-platform file download capabilities for snapshots and videos.
 * Handles platform-specific logic for Web, iOS, Android, and Electron desktop.
 *
 * Features:
 * - Web / Electron: Uses standard browser download (Blob/Anchor) — Electron's
 *   renderer behaves like a regular browser here
 * - Mobile: Uses Capacitor Filesystem and Media plugins with chunked streaming to avoid OOM
 * - Handles CORS issues via native HTTP or proxy
 * - Automatically saves media to device Photo/Video library on mobile
 */

import { log, LogLevel } from './logger';
import { Platform } from './platform';
import { wrapWithImageProxyIfNeeded } from './proxy-utils';
import { httpRequest, type HttpProgress } from './http';

import { getEventVideoUrl as buildEventVideoUrl } from './url-builder';
import { useBackgroundTasks } from '../stores/backgroundTasks';

/**
 * Progress callback for download operations
 */
export interface DownloadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

/**
 * Options for download operations
 */
export interface DownloadOptions {
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}

export function convertToSnapshotUrl(imageUrl: string): string {
  try {
    const parsedUrl = new URL(imageUrl);

    if (parsedUrl.pathname.endsWith('/image-proxy') && parsedUrl.searchParams.has('url')) {
      const targetUrl = parsedUrl.searchParams.get('url');
      if (!targetUrl) return imageUrl;
      const normalizedTarget = convertToSnapshotUrl(targetUrl);
      parsedUrl.searchParams.set('url', normalizedTarget);
      return parsedUrl.toString();
    }

    // Handle both /nph-zms and /zms streaming endpoints
    if (!parsedUrl.pathname.includes('nph-zms') && !parsedUrl.pathname.endsWith('/zms')) {
      return imageUrl;
    }

    const params = parsedUrl.searchParams;
    params.set('mode', 'single');
    params.delete('maxfps');
    params.delete('connkey');
    params.delete('buffer');
    params.delete('_t');
    params.delete('rand');
    params.delete('fps');

    parsedUrl.search = params.toString();
    return parsedUrl.toString();
  } catch {
    return imageUrl;
  }
}

/**
 * Platform-specific download handler type
 */
type DownloadHandler = (url: string, filename: string, options?: DownloadOptions) => Promise<void>;

/**
 * Platform-specific data URL snapshot handler type
 */
type DataUrlSnapshotHandler = (dataUrl: string, filename: string) => Promise<void>;

/**
 * Get the appropriate download handler for the current platform
 */
function getDownloadHandler(): DownloadHandler {
  if (Platform.isNative) return downloadFileNative;
  return downloadFileWeb;
}

/**
 * Get the appropriate data URL snapshot handler for the current platform
 */
function getDataUrlSnapshotHandler(): DataUrlSnapshotHandler {
  if (Platform.isNative) return downloadDataUrlNative;
  return downloadFromDataUrlWeb;
}

/**
 * Download a file from a URL.
 *
 * For web: triggers browser download via a temporary anchor element.
 * For mobile: streams to Documents directory in chunks and then attempts to save to Photo/Video library.
 * For desktop: prompts user for save location and streams to disk.
 *
 * @param url - The URL to download from
 * @param filename - The target filename
 * @param options - Optional download options (progress callback, abort signal)
 */
export async function downloadFile(url: string, filename: string, options?: DownloadOptions): Promise<void> {
  try {
    const handler = getDownloadHandler();
    await handler(url, filename, options);
  } catch (error) {
    log.download('[Download] Failed to download file', LogLevel.ERROR, { url, error });
    throw error;
  }
}

/**
 * Mobile Implementation (Native)
 * Downloads file using native HTTP with streaming to avoid OOM
 */
async function downloadFileNative(url: string, filename: string, options?: DownloadOptions): Promise<void> {
  log.download('[Download] Initiating native mobile download', LogLevel.INFO, { url, filename });

  // Dynamic imports for Capacitor plugins
  const { Media } = await import('@capacitor-community/media');
  const { Filesystem, Directory } = await import('@capacitor/filesystem');

  try {
    // Use unified HTTP to get base64 data without blob conversion
    // This avoids loading the entire file as a Blob in memory (OOM prevention)
    log.download('[Download] Fetching file via native HTTP', LogLevel.INFO, { url });

    const response = await httpRequest<string>(url, {
      method: 'GET',
      responseType: 'base64',
    });

    if (response.status !== 200) {
      throw new Error(`Failed to download: HTTP ${response.status}`);
    }

    // Native HTTP returns base64 string when responseType is base64/blob
    // We use it directly without converting to Blob (avoids OOM)
    const base64Data = response.data as string;

    if (options?.onProgress) {
      options.onProgress({
        loaded: base64Data.length,
        total: base64Data.length,
        percentage: 100,
      });
    }

    // Write directly to Documents directory
    const writeResult = await Filesystem.writeFile({
      path: filename,
      data: base64Data,
      directory: Directory.Documents,
    });

    log.download('[Download] File saved to Documents', LogLevel.INFO, {
      path: writeResult.uri,
      filename
    });

    // Save to Photo/Video Library using the file:// URI
    try {
      if (filename.match(/\.(jpg|jpeg|png|gif)$/i)) {
        await Media.savePhoto({ path: writeResult.uri });
        log.download('[Download] Saved to Photo Library', LogLevel.INFO, { filename });
      } else if (filename.match(/\.(mp4|mov|avi)$/i)) {
        await Media.saveVideo({ path: writeResult.uri });
        log.download('[Download] Saved to Video Library', LogLevel.INFO, { filename });
      }
    } catch (mediaError) {
      log.download('[Download] Failed to save to media library, but file is in Documents', LogLevel.WARN, { filename, error: mediaError });
    }
  } catch (error) {
    throw error;
  }
}


/**
 * Web Implementation
 */
async function downloadFileWeb(url: string, filename: string, options?: DownloadOptions): Promise<void> {
  // Web: Use unified HTTP with auth headers to avoid CORS issues
  try {
    // Use the image proxy for cross-origin URLs in dev mode
    const proxiedUrl = wrapWithImageProxyIfNeeded(url);
    if (proxiedUrl !== url) {
      log.download('Using proxy for CORS', LogLevel.INFO, { url: proxiedUrl });
    }

    log.download('Downloading file via unified HTTP', LogLevel.INFO, { url: proxiedUrl, filename });
    const response = await httpRequest<Blob>(proxiedUrl, {
      method: 'GET',
      responseType: 'blob',
      signal: options?.signal,
      onDownloadProgress: options?.onProgress
        ? (progress: HttpProgress) => {
            options.onProgress?.(progress);
          }
        : undefined,
    });

    const blob = response.data;
    const blobUrl = window.URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();

    // Fix for race condition on some browsers/webviews:
    // Delay cleanup to ensure download starts
    setTimeout(() => {
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    }, 100);

    log.download('File downloaded via browser', LogLevel.INFO, { filename });
  } catch (fetchError) {
    // If unified HTTP fails, fall back to direct download link
    // This will open in a new tab and rely on browser's download handling
    log.download('API client download failed, falling back to direct link', LogLevel.WARN, { url, error: fetchError });

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
    }, 100);

    log.download('Initiated direct download', LogLevel.INFO, { filename });
  }
}

/**
 * Download a snapshot from a data URL or image URL.
 */
export async function downloadSnapshot(imageUrl: string, monitorName: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `${monitorName}_${timestamp}.jpg`;

  // If it's a data URL, use platform-specific data URL handler
  if (imageUrl.startsWith('data:')) {
    const handler = getDataUrlSnapshotHandler();
    await handler(imageUrl, filename);
    return;
  }

  // Otherwise fetch and download
  await downloadFile(convertToSnapshotUrl(imageUrl), filename);
}

/**
 * Capture current frame from an img element and download.
 */
export async function downloadSnapshotFromElement(
  element: HTMLImageElement | HTMLVideoElement,
  monitorName: string
): Promise<void> {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `${monitorName}_${timestamp}.jpg`;

    // For video elements, capture current frame to canvas
    if (element instanceof HTMLVideoElement) {
      const canvas = document.createElement('canvas');
      canvas.width = element.videoWidth || element.clientWidth;
      canvas.height = element.videoHeight || element.clientHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }
      ctx.drawImage(element, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      await downloadSnapshot(dataUrl, monitorName);
    } else {
      // For image elements, use existing src
      const imageUrl = element.src;
      if (imageUrl.startsWith('data:')) {
        await downloadSnapshot(imageUrl, monitorName);
      } else {
        await downloadFile(convertToSnapshotUrl(imageUrl), filename);
      }
    }
  } catch (error) {
    log.download('[Download] Failed to capture snapshot', LogLevel.ERROR, error);
    throw error;
  }
}

/**
 * Mobile (Native) data URL download implementation
 */
async function downloadDataUrlNative(dataUrl: string, filename: string): Promise<void> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Media } = await import('@capacitor-community/media');

  const base64 = dataUrl.split(',')[1];
  const result = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Documents,
  });
  log.download('[Download] Snapshot saved from data URL', LogLevel.INFO, {
    path: result.uri,
    filename
  });

  // Save to Photo Library
  try {
    await Media.savePhoto({
      path: result.uri
    });
    log.download('[Download] Snapshot saved to Photo Library', LogLevel.INFO, { filename });
  } catch (mediaError) {
    log.download('[Download] Failed to save snapshot to Photo Library', LogLevel.ERROR, mediaError);
  }
}

/**
 * Web data URL download implementation
 */
async function downloadFromDataUrlWeb(dataUrl: string, filename: string): Promise<void> {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => document.body.removeChild(link), 100);
}

/**
 * Get event video download URL from ZoneMinder.
 * ZoneMinder provides videos in different formats based on event storage.
 */
export function getEventVideoDownloadUrl(
  portalUrl: string,
  eventId: string,
  token?: string,
  minStreamingPort?: number,
  monitorId?: string,
): string {
  return buildEventVideoUrl(portalUrl, eventId, { token, minStreamingPort, monitorId });
}

/**
 * Download event video with background task tracking.
 */
export function downloadEventVideo(
  portalUrl: string,
  eventId: string,
  eventName: string,
  token?: string,
  minStreamingPort?: number,
  monitorId?: string,
): string {
  const videoUrl = getEventVideoDownloadUrl(portalUrl, eventId, token, minStreamingPort, monitorId);

  // Sanitize event name for filename
  const sanitizedName = eventName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

  // Try to download with appropriate extension
  // ZoneMinder may return mp4, avi, or mjpeg depending on storage format
  const filename = `Event_${eventId}_${sanitizedName}_${timestamp}.mp4`;

  // Create abort controller for cancellation support
  const abortController = new AbortController();

  // Get background task store (cannot use hook outside component)
  const taskStore = useBackgroundTasks.getState();

  // Create background task
  const taskId = taskStore.addTask({
    type: 'download',
    metadata: {
      title: filename,
      description: `Event ${eventId}`,
    },
    cancelFn: () => {
      abortController.abort();
      log.download('Download cancelled by user', LogLevel.INFO, { eventId, filename });
    },
  });

  // Start download asynchronously
  (async () => {
    try {
      await downloadFile(videoUrl, filename, {
        signal: abortController.signal,
        onProgress: (progress) => {
          taskStore.updateProgress(taskId, progress.percentage, progress.loaded);

          // Update file size metadata on first progress update
          if (progress.total && !taskStore.tasks.find(t => t.id === taskId)?.metadata.fileSize) {
            const task = taskStore.tasks.find(t => t.id === taskId);
            if (task) {
              task.metadata.fileSize = progress.total;
            }
          }
        },
      });

      // Mark as completed
      taskStore.completeTask(taskId);
      log.download('Video download completed', LogLevel.INFO, { eventId, filename });
    } catch (error) {
      // Check if it was an abort
      if (error instanceof Error && error.name === 'AbortError') {
        // Already marked as cancelled by cancelFn
        return;
      }

      // Mark as failed
      taskStore.failTask(taskId, error instanceof Error ? error : new Error('Download failed'));
      log.download('Failed to download video', LogLevel.ERROR, { eventId, error });
    }
  })();

  return taskId;
}
