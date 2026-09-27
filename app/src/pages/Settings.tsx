/**
 * Settings Page
 *
 * Sections by topic: General, Live Streaming, Events & Playback, Network,
 * Ninjii and More settings, each in its own file under components/settings/.
 * Selection-scoped rows save to the current selection through `update`;
 * server-scoped rows sit in each section's server sub-card and save to the
 * picked (aggregate) or current profile (stores/settings-scope.ts).
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { NotificationBadge } from '../components/NotificationBadge';
import { PageContainer } from '../components/common/PageContainer';
import { ProfilePicker } from '../components/profile-picker';
import { useSettingsStore } from '../stores/settings';
import { useCurrentProfile, useProfileById } from '../hooks/useCurrentProfile';
import { useProfileScope } from '../hooks/useProfileScope';
import { type ProfileId } from '../api/types';
import { GeneralSection } from '../components/settings/GeneralSection';
import { LiveStreamingSection } from '../components/settings/LiveStreamingSection';
import { EventsPlaybackSection } from '../components/settings/EventsPlaybackSection';
import { NetworkSection } from '../components/settings/NetworkSection';
import { AssistantSection } from '../components/settings/AssistantSection';
import { MoreSettingsSection } from '../components/settings/MoreSettingsSection';
import { SettingsSearchContext, useSettingsFilter } from '../components/settings/settings-search';
import type { ProfileSettings } from '../stores/settings';

export default function Settings() {
  const { t } = useTranslation();
  const { currentProfile, settings, isAllMode } = useCurrentProfile();
  const updateSettings = useSettingsStore((state) => state.updateProfileSettings);

  // Server sub-cards need a real picked profile while aggregating - an
  // aggregate bucket makes no sense for per-server data. Picker defaults to
  // the first profile in scope (refs #337).
  const scope = useProfileScope();
  // What the aggregate sections call themselves: the group's own name. The
  // All Servers fallback is legacy - only the retired sentinel has no stored
  // name, and it is migrated away on rehydrate (refs #337).
  const aggregateName =
    (scope?.mode === 'all' ? scope.aggregateName : null) ?? t('profiles.all_servers');

  // View-level update helper: every selection-scoped row and the aggregate
  // sub-card. Targets the active aggregate's own bucket while aggregating so
  // language/date-format/etc. stay editable there, and the current profile's
  // bucket otherwise (unchanged single-mode behavior). Every aggregate keeps
  // its own bucket, so a group's knobs never write All Servers'.
  const update = <K extends keyof ProfileSettings>(
    key: K,
    value: ProfileSettings[K]
  ) => {
    const targetId = scope?.mode === 'all' ? scope.aggregateId : currentProfile?.id;
    if (!targetId) return;
    updateSettings(targetId, { [key]: value });
  };

  const [pickedProfileId, setPickedProfileId] = useState<ProfileId | undefined>(undefined);
  const defaultPickedId = isAllMode ? (pickedProfileId ?? scope?.profiles[0]?.id) : undefined;
  const { profile: pickedProfile, settings: pickedSettings } = useProfileById(defaultPickedId);
  const serverScopedProfile = isAllMode ? pickedProfile : currentProfile;
  const serverScopedSettings = isAllMode ? pickedSettings : settings;

  const updateServerScoped = <K extends keyof ProfileSettings>(
    key: K,
    value: ProfileSettings[K]
  ) => {
    if (!serverScopedProfile) return;
    updateSettings(serverScopedProfile.id, { [key]: value });
  };

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { ref: sectionsRef, noMatch } = useSettingsFilter(query);
  // Focus follows the tap that opened the field, so typing can start at once.
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);
  const closeSearch = () => {
    setQuery('');
    setSearchOpen(false);
  };

  return (
    <PageContainer spacing="loose">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-base sm:text-lg font-bold tracking-tight">{t('settings.title')}</h1>
          <NotificationBadge />
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8"
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            aria-expanded={searchOpen}
            title={t('settings.search.placeholder')}
            aria-label={t('settings.search.placeholder')}
            data-testid="settings-search-button"
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 hidden sm:block">
          {t('settings.subtitle')}
        </p>
        {searchOpen && (
          <div className="relative mt-2">
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
              placeholder={t('settings.search.placeholder')}
              aria-label={t('settings.search.placeholder')}
              className="pr-9"
              data-testid="settings-search-input"
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-1/2 -translate-y-1/2 h-8 w-8"
              onClick={closeSearch}
              title={t('common.clear')}
              aria-label={t('common.clear')}
              data-testid="settings-search-clear"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {noMatch && (
        <p className="text-sm text-muted-foreground" data-testid="settings-search-empty">
          {t('settings.search.no_results')}
        </p>
      )}

      <SettingsSearchContext.Provider value={query.trim()}>
        <div ref={sectionsRef} className="space-y-6" data-testid="settings-sections">
          {isAllMode && (
            // Kept while searching: it picks whose settings every server
            // sub-card shows.
            <div data-settings-search-keep>
              <ProfilePicker
                profiles={scope?.profiles ?? []}
                value={defaultPickedId}
                onChange={setPickedProfileId}
              />
            </div>
          )}

          <GeneralSection
            settings={settings}
            update={update}
            serverProfile={serverScopedProfile}
            serverSettings={serverScopedSettings}
            updateSettings={updateSettings}
          />
          <LiveStreamingSection
            settings={settings}
            update={update}
            serverProfile={serverScopedProfile}
            serverSettings={serverScopedSettings}
            updateServer={updateServerScoped}
            updateSettings={updateSettings}
            aggregateName={isAllMode ? aggregateName : null}
          />
          <EventsPlaybackSection
            settings={settings}
            update={update}
            serverProfile={serverScopedProfile}
            serverSettings={serverScopedSettings}
            updateServer={updateServerScoped}
          />
          <NetworkSection
            settings={settings}
            update={update}
            isAllMode={isAllMode}
            serverProfile={serverScopedProfile}
            serverSettings={serverScopedSettings}
            updateSettings={updateSettings}
          />
          <AssistantSection
            settings={serverScopedSettings}
            update={updateServerScoped}
            currentProfile={serverScopedProfile}
            updateSettings={updateSettings}
          />
          <MoreSettingsSection />
        </div>
      </SettingsSearchContext.Provider>
    </PageContainer>
  );
}
