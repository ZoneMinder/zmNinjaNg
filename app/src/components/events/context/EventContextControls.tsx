/**
 * Window and camera-scope controls for the "around this event" panel
 * (refs #494). A scope the server cannot offer (no linked monitors, no
 * group) stays visible and greyed through `useDeniedControl` rather than
 * disappearing, so it can say why instead of just not being there.
 */
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import { useDeniedControl } from '../../../hooks/useDeniedControl';
import { EVENT_CONTEXT } from '../../../lib/zmninja-ng-constants';
import { EVENT_CONTEXT_SCOPES, type EventContextScope } from '../../../lib/event/event-context';
import type { EventContextSettings } from '../../../stores/settings';

export interface EventContextControlsProps {
  value: EventContextSettings;
  onChange: (next: EventContextSettings) => void;
  available: { linked: boolean; group: boolean };
}

function isScopeEnabled(scope: EventContextScope, available: { linked: boolean; group: boolean }) {
  return scope === 'all' || available[scope];
}

function ScopeSegment({
  scope,
  active,
  enabled,
  onSelect,
}: {
  scope: EventContextScope;
  active: boolean;
  enabled: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const props = useDeniedControl({
    denied: !enabled,
    message: t(`events.around.scope_unavailable_${scope}`),
    onClick: onSelect,
  });

  return (
    <Button
      size="sm"
      variant={active ? 'default' : 'outline'}
      aria-pressed={active}
      data-testid={`event-context-scope-${scope}`}
      {...props}
    >
      {t(`events.around.scope_${scope}`)}
    </Button>
  );
}

export function EventContextControls({ value, onChange, available }: EventContextControlsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 pb-3">
      {/* Six chips do not fit 320px on one line, so they wrap rather than
          overflow the panel. */}
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('events.around.window')}>
        {EVENT_CONTEXT.windowChoices.map((minutes) => (
          <Button
            key={minutes}
            size="sm"
            variant={value.windowMinutes === minutes ? 'default' : 'outline'}
            aria-pressed={value.windowMinutes === minutes}
            onClick={() => onChange({ ...value, windowMinutes: minutes })}
            data-testid={`event-context-window-${minutes}`}
          >
            {t('events.around.minutes', { count: minutes })}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1" role="group" aria-label={t('events.around.scope')}>
        {EVENT_CONTEXT_SCOPES.map((scope) => (
          <ScopeSegment
            key={scope}
            scope={scope}
            active={value.scope === scope}
            enabled={isScopeEnabled(scope, available)}
            onSelect={() => onChange({ ...value, scope })}
          />
        ))}
      </div>
    </div>
  );
}
