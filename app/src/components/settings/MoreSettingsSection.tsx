/**
 * More settings: pages that keep their own settings. Each link is a card row,
 * so search finds it by the page's name.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { CollapsibleSection, SettingsCard, RowLabel } from './SettingsLayout';

export function MoreSettingsSection() {
  const { t } = useTranslation();

  return (
    <CollapsibleSection id="more" label={t('settings.section_more')}>
      <SettingsCard>
        <Link
          to="/notifications"
          className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50"
          data-testid="settings-link-notifications"
        >
          <RowLabel label={t('sidebar.notifications')} />
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </SettingsCard>
    </CollapsibleSection>
  );
}
