/**
 * Desktop per-host connection limit (refs #156)
 *
 * Chromium reads `max-connections-per-host` once at startup, so the value
 * lives in a file the Electron main process reads at boot (see
 * electron/main.cjs), not in the settings store, and a change applies on the
 * next launch. It is per install, so this row sits directly in the Live
 * Streaming card rather than the server-scoped Advanced streaming fold.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '../ui/input';
import { RowLabel } from './SettingsLayout';
import { Platform } from '../../lib/platform';
import { log, LogLevel } from '../../lib/logger';
import { ZM_INTEGRATION } from '../../lib/zmninja-ng-constants';

declare global {
  interface Window {
    /** Electron preload bridge (`electron/preload.cjs`). Absent everywhere
     *  else, and on an Electron build still running an older preload. */
    electronConnections?: {
      get(): Promise<number>;
      /** Resolves with the clamped value actually stored. */
      set(value: number): Promise<number>;
    };
  }
}

const { min, max } = ZM_INTEGRATION.desktopConnections;

export function DesktopConnectionsRow() {
  const { t } = useTranslation();
  const bridge = Platform.isElectron ? window.electronConnections : undefined;
  const [stored, setStored] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    bridge
      .get()
      .then((value) => {
        setStored(value);
        setDraft(String(value));
      })
      .catch((error) => log.app('electronConnections.get() failed', LogLevel.WARN, { error }));
  }, [bridge]);

  if (!bridge) return null;

  const commit = async () => {
    // Main rejects non-integers; round so a typed 1.5 is not a dead end.
    const value = Math.round(Number(draft));
    if (draft.trim() === '' || value === stored) {
      setDraft(stored === null ? '' : String(stored));
      return;
    }
    try {
      const kept = await bridge.set(value);
      setStored(kept);
      setDraft(String(kept));
      setSaved(true);
    } catch (error) {
      log.app('electronConnections.set() failed', LogLevel.WARN, { error });
      setDraft(stored === null ? '' : String(stored));
    }
  };

  return (
    <div className="px-4 py-3 space-y-2">
      <RowLabel
        label={t('settings.desktop_connections')}
        desc={t('settings.desktop_connections_desc')}
      />
      <Input
        id="desktop-connections"
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="w-24"
        data-testid="settings-desktop-connections"
      />
      {saved && (
        <p className="text-xs text-muted-foreground" data-testid="settings-desktop-connections-restart">
          {t('settings.desktop_connections_restart')}
        </p>
      )}
    </div>
  );
}
