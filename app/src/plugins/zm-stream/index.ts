import { registerPlugin } from '@capacitor/core';
import type { ZmStreamPlugin } from './definitions';

const ZmStream = registerPlugin<ZmStreamPlugin>('ZmStream', {
  web: () => import('./web').then((m) => new m.ZmStreamWeb()),
});

export const ZM_FRAME_SCHEME = 'zmframe';

/** URL of frame `n` of a native stream. `n` makes each request unique so the webview refetches. */
export function zmFrameUrl(streamId: string, n: number): string {
  return `${ZM_FRAME_SCHEME}://frames/${streamId}/${n}`;
}

/** Inverse of zmFrameUrl: the stream id, or null when `url` is not a zmframe URL. */
export function zmFrameStreamId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== `${ZM_FRAME_SCHEME}:`) return null;
    // zmframe://frames/<id>/<n> parses as host "frames", pathname "/<id>/<n>"
    return u.pathname.split('/')[1] || null;
  } catch {
    return null;
  }
}

export * from './definitions';
export { ZmStream };
