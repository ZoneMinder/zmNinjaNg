/**
 * Stream path row in the Live Streaming server rows (refs #603): one compact
 * line per nph-zms URL the server's monitors stream from, saying whether that
 * URL answered a frame (see hooks/useZmsProbes.ts).
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { useZmsProbes, type ZmsProbeEntry } from '../../hooks/useZmsProbes';
import { streamUrlLabel } from '../../lib/zm/zms-probe';
import type { ProfileId } from '../../api/types';

function ProbeLine({ entry }: { entry: ZmsProbeEntry }) {
  const { t } = useTranslation();
  const url = streamUrlLabel(entry.recordingUrl);
  const result = entry.result;

  if (result?.state === 'ok') {
    const text = t('settings.zms_probe_ok', { url });
    return (
      <p className="flex items-center gap-1 min-w-0 text-xs text-green-600 dark:text-green-400" data-testid="settings-zms-probe-ok">
        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate" title={text}>{text}</span>
      </p>
    );
  }
  if (result?.state === 'failed') {
    const text = t('settings.zms_probe_failed', { status: result.status, url });
    return (
      <p
        className="min-w-0 truncate rounded px-2 py-0.5 text-xs bg-destructive text-destructive-foreground"
        title={text}
        data-testid="settings-zms-probe-failed"
      >
        {text}
      </p>
    );
  }
  const text = result ? t('settings.zms_probe_unknown', { url }) : t('settings.zms_probe_checking', { url });
  return (
    <p
      className="min-w-0 truncate text-xs text-muted-foreground"
      title={text}
      data-testid={result ? 'settings-zms-probe-unknown' : 'settings-zms-probe-checking'}
    >
      {text}
    </p>
  );
}

export function ZmsProbeRow({ profileId }: { profileId: ProfileId }) {
  const { t } = useTranslation();
  const ids = useMemo(() => [profileId], [profileId]);
  const probes = useZmsProbes(ids);
  if (probes.length === 0) return null;
  return (
    <div className="px-4 py-3 space-y-1 min-w-0">
      <div className="text-sm font-medium">{t('settings.zms_probe_label')}</div>
      {probes.map((entry) => (
        <ProbeLine key={entry.recordingUrl} entry={entry} />
      ))}
    </div>
  );
}
