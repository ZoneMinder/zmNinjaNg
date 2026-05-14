import { WebPlugin } from '@capacitor/core';
import type { SafeAreaInsets, SafeAreaPlugin } from './definitions';

/**
 * Web/Android stub. Returns zeros; on iOS the native plugin reports correct
 * values from UIView.safeAreaInsets. CSS usages should keep an env() fallback
 * so the browser-native value still applies when this stub is in effect.
 */
export class SafeAreaWeb extends WebPlugin implements SafeAreaPlugin {
  async getInsets(): Promise<SafeAreaInsets> {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
}
