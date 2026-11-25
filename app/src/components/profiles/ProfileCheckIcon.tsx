/**
 * Green check circle or red cross for one of a profile's addresses
 * (useProfileChecks, refs #603). Renders nothing when the check can't tell.
 */

import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { ProfileCheck } from '../../hooks/useProfileChecks';

export function ProfileCheckIcon({ check, testId }: { check: ProfileCheck; testId: string }) {
  const { t } = useTranslation();
  if (!check) return null;
  const ok = check.state === 'ok';
  const label = ok ? t('profiles.check_ok') : t('profiles.check_failed', { status: check.status });
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <Icon
      className={`inline h-3.5 w-3.5 shrink-0 align-[-2px] ${ok ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}
      role="img"
      aria-label={label}
      data-testid={`${testId}-${ok ? 'ok' : 'failed'}`}
    >
      <title>{label}</title>
    </Icon>
  );
}
