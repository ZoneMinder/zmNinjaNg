import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();

// A fake Channel that lets the test push messages to whatever onmessage handler
// the wrapper installs, mirroring @tauri-apps/api/core's Channel.
// Defined via vi.hoisted so it is available inside the vi.mock factory (which is
// hoisted to the top of the file by vitest's transform).
const { FakeChannel } = vi.hoisted(() => {
  class FakeChannel<T> {
    onmessage: ((msg: T) => void) | null = null;
    emit(msg: T) {
      this.onmessage?.(msg);
    }
  }
  return { FakeChannel };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  Channel: FakeChannel,
}));

vi.mock('../ssl-trust', () => ({
  isTauriSslTrustEnabled: vi.fn(() => true),
}));

import { startMjpegStream, stopMjpegStream } from '../tauri-mjpeg';

describe('tauri-mjpeg wrapper', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('invokes mjpeg_start with the url, ssl-trust flag, and a channel, returning the id', async () => {
    invoke.mockResolvedValue(7);
    const onFrame = vi.fn();
    const onError = vi.fn();

    const id = await startMjpegStream('https://zm/nph-zms?mode=jpeg', onFrame, onError);

    expect(id).toBe(7);
    expect(invoke).toHaveBeenCalledTimes(1);
    const [command, args] = invoke.mock.calls[0];
    expect(command).toBe('mjpeg_start');
    expect(args).toMatchObject({
      url: 'https://zm/nph-zms?mode=jpeg',
      acceptInvalidCerts: true,
    });
    expect(args.onFrame).toBeInstanceOf(FakeChannel);
  });

  it('routes ArrayBuffer messages to onFrame and JSON error messages to onError', async () => {
    let captured: InstanceType<typeof FakeChannel<unknown>> | undefined;
    invoke.mockImplementation(async (_cmd: string, args: { onFrame: InstanceType<typeof FakeChannel<unknown>> }) => {
      captured = args.onFrame;
      return 1;
    });
    const onFrame = vi.fn();
    const onError = vi.fn();

    await startMjpegStream('https://zm/x', onFrame, onError);

    const frame = new ArrayBuffer(8);
    captured!.emit(frame);
    captured!.emit({ type: 'error', message: 'boom' });

    expect(onFrame).toHaveBeenCalledWith(frame);
    expect(onError).toHaveBeenCalledWith('boom');
  });

  it('normalizes a typed-array (Uint8Array) frame message to an ArrayBuffer', async () => {
    let captured: InstanceType<typeof FakeChannel<unknown>> | undefined;
    invoke.mockImplementation(async (_cmd: string, args: { onFrame: InstanceType<typeof FakeChannel<unknown>> }) => {
      captured = args.onFrame;
      return 1;
    });
    const onFrame = vi.fn();
    const onError = vi.fn();

    await startMjpegStream('https://zm/x', onFrame, onError);

    captured!.emit(new Uint8Array([1, 2, 3]));

    expect(onFrame).toHaveBeenCalledTimes(1);
    const received = onFrame.mock.calls[0][0];
    expect(received).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(received))).toEqual([1, 2, 3]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('stops a stream by id', async () => {
    invoke.mockResolvedValue(undefined);
    await stopMjpegStream(42);
    expect(invoke).toHaveBeenCalledWith('mjpeg_stop', { streamId: 42 });
  });
});
