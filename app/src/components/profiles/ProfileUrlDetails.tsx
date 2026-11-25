/**
 * A profile card's Details: its portal, API and streaming addresses, each
 * marked with whether it answers (useProfileChecks, refs #603).
 */

import { useTranslation } from 'react-i18next';
import { ServerUrlDisclosure } from './ServerUrlDisclosure';
import { ProfileCheckIcon } from './ProfileCheckIcon';
import { useProfileChecks } from '../../hooks/useProfileChecks';
import type { Profile } from '../../api/types';

export function ProfileUrlDetails({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const checks = useProfileChecks(profile);
  const rows = [
    { kind: 'portal', label: t('profiles.portal'), url: profile.portalUrl, check: checks.portal },
    { kind: 'api', label: t('profiles.api'), url: profile.apiUrl, check: checks.api },
    { kind: 'streaming', label: t('profiles.streaming'), url: profile.cgiUrl, check: checks.streaming },
  ] as const;
  return (
    <ServerUrlDisclosure
      testId={`profile-urls-${profile.id}`}
      rows={rows
        .filter((row) => row.url)
        .map(({ kind, label, url, check }) => ({
          label,
          url,
          icon: <ProfileCheckIcon check={check} testId={`profile-url-check-${kind}`} />,
        }))}
    />
  );
}
