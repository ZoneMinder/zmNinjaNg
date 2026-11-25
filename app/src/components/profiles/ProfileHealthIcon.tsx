/**
 * One icon next to a profile's name for its three address checks
 * (useProfileChecks, refs #603): green when portal, API and streaming all
 * answer, a warning when some fail and some answer, red when something fails
 * and nothing answers (a failed API leaves no monitor to probe the stream
 * with, so "all three failed" can't be waited for). Nothing while checks run
 * or can't tell and none has failed, or for a disabled profile.
 */

import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useProfileChecks } from '../../hooks/useProfileChecks';
import type { Profile } from '../../api/types';

const LOOKS = {
  ok: { Icon: CheckCircle2, color: 'text-green-600 dark:text-green-400' },
  partial: { Icon: AlertTriangle, color: 'text-amber-600 dark:text-amber-400' },
  failed: { Icon: XCircle, color: 'text-destructive' },
} as const;

export function ProfileHealthIcon({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const checks = Object.values(useProfileChecks(profile));
  const failed = checks.filter((c) => c?.state === 'failed').length;
  const ok = checks.filter((c) => c?.state === 'ok').length;

  const health =
    failed > 0 && ok === 0 ? 'failed'
    : failed > 0 ? 'partial'
    : ok === checks.length ? 'ok'
    : null;
  if (!health) return null;

  const { Icon, color } = LOOKS[health];
  const label = t(`profiles.health_${health}`);
  return (
    <Icon className={`h-4 w-4 shrink-0 ${color}`} role="img" aria-label={label} data-testid={`profile-health-${health}`}>
      <title>{label}</title>
    </Icon>
  );
}
