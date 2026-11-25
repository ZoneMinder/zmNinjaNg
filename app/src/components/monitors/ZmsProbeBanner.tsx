/**
 * Banner on the live pages when a profile's nph-zms URL refused the probe's
 * frame request (refs #603), so a wrong CGI path doesn't look like a row of
 * offline monitors. Says nothing while the probe runs, when it passes, or when
 * it couldn't tell (see hooks/useZmsProbes.ts).
 */

import { useTranslation } from 'react-i18next';
import { ErrorBanner } from '../ui/query-state';
import { cn } from '../../lib/utils';
import { useZmsProbes } from '../../hooks/useZmsProbes';
import type { ProfileId } from '../../api/types';

export function ZmsProbeBanner({ profileIds, className }: { profileIds: readonly ProfileId[]; className?: string }) {
  const { t } = useTranslation();
  const probes = useZmsProbes(profileIds);
  const failed = probes.flatMap((e) => (e.result?.state === 'failed' ? [{ ...e, result: e.result }] : []));
  if (failed.length === 0) return null;
  return (
    <div className={cn('space-y-2', className)} data-testid="zms-probe-banner">
      {failed.map((e) => {
        const message = t('monitors.zms_probe_failed', { status: e.result.status, path: e.result.path });
        return (
          <ErrorBanner
            key={`${e.profileId}|${e.recordingUrl}`}
            message={profileIds.length > 1 ? `${e.profileName}: ${message}` : message}
          />
        );
      })}
    </div>
  );
}
