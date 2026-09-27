/**
 * More settings: pages that keep their own settings. Each link is a card row,
 * so search finds it by the page's name.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { CollapsibleSection, SettingsCard, RowLabel } from './SettingsLayout';

const LINKS = [
  { to: '/notifications', labelKey: 'sidebar.notifications', testId: 'settings-link-notifications' },
  { to: '/live-activity', labelKey: 'sidebar.live_activity', testId: 'settings-link-live-activity' },
  { to: '/logs', labelKey: 'sidebar.logs', testId: 'settings-link-logs' },
] as const;

export function MoreSettingsSection() {
  const { t } = useTranslation();

  return (
    <CollapsibleSection id="more" label={t('settings.section_more')}>
      <SettingsCard>
        {LINKS.map(({ to, labelKey, testId }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50"
            data-testid={testId}
          >
            <RowLabel label={t(labelKey)} />
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
        <div className="px-4 py-3">
          <RowLabel
            label={t('settings.per_monitor_settings')}
            desc={t('settings.per_monitor_settings_desc')}
          />
        </div>
      </SettingsCard>
    </CollapsibleSection>
  );
}
