/**
 * Platform Detection Utilities
 *
 * Centralized platform detection for consistent environment checks across the app.
 * Supported platforms: web (browser), Electron desktop, and Capacitor native (iOS/Android).
 */

import { Capacitor } from '@capacitor/core';

/**
 * Platform detection utilities.
 * Use these constants instead of checking environment flags directly.
 * All properties use getters for lazy evaluation to ensure runtime is ready.
 */
export const Platform = {
  /** True if running in development mode (Vite dev server) */
  get isDev() {
    return import.meta.env.DEV;
  },

  /** True if running on native platform (iOS or Android via Capacitor) */
  get isNative() {
    return Capacitor.isNativePlatform();
  },

  /** True if running on iOS via Capacitor. */
  get isIOS() {
    return Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
  },

  /** True if running on Android via Capacitor. */
  get isAndroid() {
    return Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform();
  },

  /**
   * True if running inside an Electron desktop shell. Electron sets a UA that
   * includes "Electron/<version>".
   */
  get isElectron() {
    return typeof navigator !== 'undefined' && /\belectron\b/i.test(navigator.userAgent);
  },

  /**
   * True if running on desktop or web (i.e., not mobile native).
   */
  get isDesktopOrWeb() {
    return !this.isNative;
  },

  /**
   * True if running in a regular web browser (not Capacitor, not Electron).
   */
  get isWeb() {
    return !this.isNative && !this.isElectron;
  },

  /**
   * True if should use development proxy server. Only true in dev mode on the
   * web, where CORS would otherwise block direct ZM portal requests. Electron
   * and Capacitor talk to the server directly through their native HTTP paths.
   */
  get shouldUseProxy() {
    return this.isDev && this.isWeb;
  },

  /**
   * True if running on an Android TV or Fire Stick device.
   * Checks native-injected global first (definitive), then user agent as fallback.
   */
  get isTVDevice() {
    // Native side injects this before web content loads
    if ((window as unknown as Record<string, unknown>).__ZMNINJA_IS_TV__) return true;
    const ua = navigator.userAgent.toLowerCase();
    return /\b(tv|aft|stb|android tv|fire tv|bravia|smart-tv|smarttv|googletv)\b/.test(ua);
  },
};
