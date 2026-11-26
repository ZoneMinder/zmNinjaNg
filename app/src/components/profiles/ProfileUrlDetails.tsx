/**
 * A profile card's Details: its portal, API and streaming addresses, each
 * marked with whether it answers (useProfileChecks, refs #603). The rows only
 * mount once Details is open, so a profile that isn't current is checked
 * (and logged in to) only when the user asks.
 */

import { useTranslation } from 'react-i18next';
import { ServerUrlDisclosure } from './ServerUrlDisclosure';
import { ProfileCheckIcon } from './ProfileCheckIcon';
import { useProfileChecks, type ProfileChecks } from '../../hooks/useProfileChecks';
import type { Profile } from '../../api/types';

/** One row's mark. Each row runs the checks; React Query shares the requests. */
function CheckFor({ profile, kind }: { profile: Profile; kind: keyof ProfileChecks }) {
  const check = useProfileChecks(profile)[kind];
  return <ProfileCheckIcon check={check} testId={`profile-url-check-${kind}`} />;
}

export function ProfileUrlDetails({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const rows = [
    { kind: 'portal', label: t('profiles.portal'), url: profile.portalUrl },
    { kind: 'api', label: t('profiles.api'), url: profile.apiUrl },
    { kind: 'streaming', label: t('profiles.streaming'), url: profile.cgiUrl },
  ] as const;
  return (
    <ServerUrlDisclosure
      testId={`profile-urls-${profile.id}`}
      rows={rows
        .filter((row) => row.url)
        .map(({ kind, label, url }) => ({
          label,
          url,
          icon: <CheckFor profile={profile} kind={kind} />,
        }))}
    />
  );
}
