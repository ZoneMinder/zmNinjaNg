/**
 * Settings Page
 *
 * Three-section flat settings layout: Appearance, Streaming & Playback, Advanced.
 * Each section is extracted into its own component under components/settings/.
 */

import { useTranslation } from 'react-i18next';
import { NotificationBadge } from '../components/NotificationBadge';
import { PageContainer } from '../components/common/PageContainer';
import { useSettingsStore } from '../stores/settings';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { AppearanceSection } from '../components/settings/AppearanceSection';
import { LiveStreamingSection } from '../components/settings/LiveStreamingSection';
import { PlaybackSection } from '../components/settings/PlaybackSection';
import { AdvancedSection } from '../components/settings/AdvancedSection';
import { HiddenMonitorsSection } from '../components/settings/HiddenMonitorsSection';
import type { ProfileSettings } from '../stores/settings';

export default function Settings() {
  const { t } = useTranslation();
  const { currentProfile, settings } = useCurrentProfile();
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);

  // Generic update helper
  const update = <K extends keyof ProfileSettings>(
    key: K,
    value: ProfileSettings[K]
  ) => {
    if (!currentProfile) return;
    updateSettings(currentProfile.id, { [key]: value });
  };

  return (
    <PageContainer spacing="loose">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-base sm:text-lg font-bold tracking-tight">{t('settings.title')}</h1>
          <NotificationBadge />
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 hidden sm:block">
          {t('settings.subtitle')}
        </p>
      </div>

      <AppearanceSection settings={settings} update={update} />
      <LiveStreamingSection
        settings={settings}
        update={update}
        currentProfile={currentProfile}
        updateSettings={updateSettings}
      />
      <PlaybackSection
        settings={settings}
        update={update}
        currentProfile={currentProfile}
        updateSettings={updateSettings}
      />
      <HiddenMonitorsSection
        settings={settings}
        currentProfile={currentProfile}
        updateSettings={updateSettings}
      />
      <AdvancedSection
        settings={settings}
        currentProfile={currentProfile}
        updateSettings={updateSettings}
      />
    </PageContainer>
  );
}
