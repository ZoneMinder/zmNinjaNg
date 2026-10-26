import { WebPlugin } from '@capacitor/core';
import type { ZmStreamHandle, ZmStreamOpenOptions, ZmStreamPlugin } from './definitions';

/** Web stub: the native frame transport exists only on iOS and Android. */
export class ZmStreamWeb extends WebPlugin implements ZmStreamPlugin {
  async open(_options: ZmStreamOpenOptions): Promise<ZmStreamHandle> {
    throw this.unavailable('ZmStream frame transport is native only');
  }

  async close(_options: ZmStreamHandle): Promise<void> {}

  async closeAll(): Promise<void> {}
}
