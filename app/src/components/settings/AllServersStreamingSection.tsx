/**
 * All Servers Streaming Mode
 *
 * Rendered only while aggregating, above the per-server profile picker, so it
 * reads as what it is: one setting governing every tile from every server,
 * rather than another row belonging to the picked profile below it.
 *
 * Three states, because two cannot express "leave each server alone". Per
 * server is the default, and sends the stream path (`useViewPrefs`) back to
 * each tile's owning profile; the other two impose one mode on every tile.
 * Without this row nothing could write the setting, and All mode would be
 * stuck on whatever its default said.
 */

import { useTranslation } from 'react-i18next';
import { Image, Video as VideoIcon, Server } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { SettingsRow, RowLabel } from './SettingsLayout';
import type { AllModeViewMode } from '../../stores/settings';

export interface AllServersStreamingSectionProps {
  value: AllModeViewMode;
  onChange: (value: AllModeViewMode) => void;
  /** The aggregate this row governs: a group's name, or the localized All
   *  Servers label. It names what "every tile" means here, since a group's
   *  tiles are only its members'. */
  name: string;
}

export function AllServersStreamingSection({
  value,
  onChange,
  name,
}: AllServersStreamingSectionProps) {
  const { t } = useTranslation();
  const label = t('settings.all_mode_streaming_label', { name });

  const descKey =
    value === 'streaming'
      ? 'settings.all_mode_streaming_streaming_desc'
      : value === 'snapshot'
        ? 'settings.all_mode_streaming_snapshot_desc'
        : 'settings.all_mode_streaming_per_server_desc';

  return (
    <SettingsRow>
      <RowLabel
        label={label}
        desc={t(descKey)}
      />
      <Select value={value} onValueChange={(next) => onChange(next as AllModeViewMode)}>
        <SelectTrigger
          className="w-36 flex-shrink-0"
          aria-label={label}
          data-testid="all-mode-streaming-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="per-server" data-testid="all-mode-streaming-option-per-server">
            <span className="flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5" />
              {t('settings.all_mode_streaming_per_server')}
            </span>
          </SelectItem>
          <SelectItem value="streaming" data-testid="all-mode-streaming-option-streaming">
            <span className="flex items-center gap-1.5">
              <VideoIcon className="h-3.5 w-3.5" />
              {t('settings.streaming')}
            </span>
          </SelectItem>
          <SelectItem value="snapshot" data-testid="all-mode-streaming-option-snapshot">
            <span className="flex items-center gap-1.5">
              <Image className="h-3.5 w-3.5" />
              {t('settings.snapshot')}
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}
