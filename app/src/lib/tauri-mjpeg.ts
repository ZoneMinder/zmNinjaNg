/**
 * Tauri MJPEG streaming wrapper.
 *
 * Bridges the Rust mjpeg_start/mjpeg_stop commands to the webview. Frames arrive
 * on a Channel as raw bytes (ArrayBuffer); errors arrive as a JSON object. The
 * Rust side owns the nph-zms socket so WebKitGTK never opens one (refs #155, #150).
 */

import { invoke, Channel } from '@tauri-apps/api/core';
import { isTauriSslTrustEnabled } from './ssl-trust';

interface MjpegErrorMessage {
  type: 'error';
  message: string;
}

type MjpegMessage = ArrayBuffer | MjpegErrorMessage;

/**
 * Start a Rust-owned MJPEG stream. Resolves with a stream id to pass to
 * stopMjpegStream. onFrame receives raw JPEG bytes per frame; onError receives a
 * message string when the stream fails or ends.
 */
export async function startMjpegStream(
  url: string,
  onFrame: (bytes: ArrayBuffer) => void,
  onError: (message: string) => void,
): Promise<number> {
  const channel = new Channel<MjpegMessage>();
  channel.onmessage = (message) => {
    if (message instanceof ArrayBuffer) {
      onFrame(message);
    } else if (message && typeof message === 'object' && message.type === 'error') {
      onError(message.message);
    }
  };

  return invoke<number>('mjpeg_start', {
    url,
    acceptInvalidCerts: isTauriSslTrustEnabled(),
    onFrame: channel,
  });
}

/** Cancel a running stream. Safe to call with an already-finished id. */
export async function stopMjpegStream(streamId: number): Promise<void> {
  await invoke('mjpeg_stop', { streamId });
}
