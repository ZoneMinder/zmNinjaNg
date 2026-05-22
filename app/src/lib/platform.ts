/**
 * Platform Detection Utilities
 *
 * Centralized platform detection for consistent environment checks across the app.
 * Handles detection of development mode, native platforms (iOS/Android), Tauri desktop, and web.
 */

import { Capacitor } from '@capacitor/core';
import { isTauri } from '@tauri-apps/api/core';

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

  /** True if running on iOS via Capacitor (not Tauri WKWebView on macOS). */
  get isIOS() {
    return Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
  },

  /** True if running on Android via Capacitor. */
  get isAndroid() {
    return Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform();
  },

  /** True if running in Tauri desktop app */
  get isTauri() {
    return isTauri();
  },

  /**
   * True if running in the Tauri desktop app on Linux (WebKitGTK).
   * WebKitGTK is the only webview that leaks on direct nph-zms `<img>` streaming
   * (CLOSE_WAIT sockets, #150/#155) and on per-frame image resources (network
   * process memory). macOS (WKWebView), Windows (WebView2), and mobile render
   * multipart MJPEG in `<img>` natively, so the Rust MJPEG + data: URL + cache
   * purge workaround is gated to this. UA on WebKitGTK is `X11; Linux ...`;
   * macOS is `Macintosh`, Windows is `Windows NT`. (Android UA also says Linux
   * but is Capacitor-native, so isTauri is false there.)
   */
  get isTauriLinux() {
    return (
      this.isTauri &&
      typeof navigator !== 'undefined' &&
      navigator.userAgent.includes('Linux')
    );
  },

  /**
   * True if running on desktop (Tauri) or web browser — i.e., not mobile native.
   * Handles the edge case where Capacitor misdetects Tauri's WKWebView as iOS.
   */
  get isDesktopOrWeb() {
    return !this.isNative || this.isTauri;
  },

  /**
   * True if running in web browser (not native or Tauri).
   */
  get isWeb() {
    return !this.isNative && !this.isTauri;
  },

  /**
   * True if should use development proxy server.
   * Only true in dev mode on web (not native platforms).
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
