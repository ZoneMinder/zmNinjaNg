/**
 * Stream badge on a Profiles card (refs #603): whether the profile's stream
 * path answers a frame (see hooks/useZmsProbes.ts). Red when any of its
 * stream URLs fails, green when every one answers, amber when the path was
 * guessed at setup and the probe can't tell. Nothing while checking, or for a
 * disabled profile, which is never probed.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/badge';
import { useZmsProbes } from '../../hooks/useZmsProbes';
import type { Profile } from '../../api/types';

export function ProfileStreamBadge({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const ids = useMemo(() => (profile.disabled ? [] : [profile.id]), [profile.disabled, profile.id]);
  const results = useZmsProbes(ids).map((e) => e.result);

  const failed = results.find((r) => r?.state === 'failed');
  if (failed?.state === 'failed') {
    return (
      <Badge variant="destructive" className="text-xs" data-testid="profile-stream-badge-failed">
        {t('profiles.stream_failed', { status: failed.status })}
      </Badge>
    );
  }
  if (results.length > 0 && results.every((r) => r?.state === 'ok')) {
    return (
      <Badge variant="success" className="text-xs" data-testid="profile-stream-badge-ok">
        {t('profiles.stream_ok')}
      </Badge>
    );
  }
  if (profile.cgiUrlGuessed && !profile.disabled) {
    return (
      <Badge
        variant="outline"
        className="text-xs text-amber-600 dark:text-amber-400 border-amber-600 dark:border-amber-400"
        data-testid="profile-stream-badge-guessed"
      >
        {t('profiles.stream_guessed')}
      </Badge>
    );
  }
  return null;
}
