import { registerPlugin } from '@capacitor/core';
import { Platform } from './platform';
import { log, LogLevel } from './logger';

interface WindowThemePluginInterface {
  setBackgroundColor(options: { color: string }): Promise<void>;
}

const WindowTheme = registerPlugin<WindowThemePluginInterface>('WindowTheme');

function rgbStringToHex(rgb: string): string | null {
  const match = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return null;
  const [, r, g, b] = match;
  const hex = (n: string) => Number(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function syncNativeWindowBackground(): void {
  if (!Platform.isAndroid) return;
  if (typeof window === 'undefined') return;

  const computed = getComputedStyle(window.document.documentElement).backgroundColor;
  const hex = rgbStringToHex(computed);
  if (!hex) {
    log.app('Could not parse theme background color', LogLevel.WARN, { computed });
    return;
  }

  WindowTheme.setBackgroundColor({ color: hex }).catch((err: unknown) => {
    log.app('Failed to set native window background', LogLevel.WARN, { hex, err });
  });
}
