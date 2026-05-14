import type { PluginListenerHandle } from '@capacitor/core';

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SafeAreaInsetsChangedEvent extends SafeAreaInsets {}

export interface SafeAreaPlugin {
  /** Read the current safe-area insets in CSS pixels. */
  getInsets(): Promise<SafeAreaInsets>;

  /**
   * Fires when iOS reports a change to UIView.safeAreaInsets — typically on
   * orientation change, status-bar visibility change, or split-view resize.
   * Native iOS only; the web/Android stub never invokes this listener.
   */
  addListener(
    eventName: 'safeAreaInsetsChanged',
    listener: (event: SafeAreaInsetsChangedEvent) => void,
  ): Promise<PluginListenerHandle>;
}
