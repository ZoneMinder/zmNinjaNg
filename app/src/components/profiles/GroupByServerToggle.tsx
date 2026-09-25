/**
 * Group By Server Toggle
 *
 * The stacking toggle (`Layers` icon) for surfaces that section an
 * aggregate's items by owning server, reading and writing one of the two
 * existing group-by-server settings in the active aggregate's own bucket
 * (refs #501, #529). Renders nothing for a single profile, which has only
 * one server to group by.
 */

import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import { Button } from '../ui/button';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useProfileStore } from '../../stores/profile';
import { useSettingsStore } from '../../stores/settings';

interface GroupByServerToggleProps {
  setting: 'monitorsGroupByServer' | 'eventsGroupByServer';
  testId: string;
  className?: string;
}

export function GroupByServerToggle({ setting, testId, className }: GroupByServerToggleProps) {
  const { t } = useTranslation();
  const { settings, isAllMode } = useCurrentProfile();
  // The aggregate's own id while it is current (currentProfile is null then).
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);

  if (!isAllMode || !currentProfileId) return null;
  const pressed = settings[setting];

  return (
    <Button
      variant={pressed ? 'default' : 'outline'}
      size="icon"
      className={className}
      aria-pressed={pressed}
      title={t('monitors.group_by_server')}
      aria-label={t('monitors.group_by_server')}
      onClick={() => updateSettings(currentProfileId, { [setting]: !pressed })}
      data-testid={testId}
    >
      <Layers className="h-4 w-4" />
    </Button>
  );
}
