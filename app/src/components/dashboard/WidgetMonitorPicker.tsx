/**
 * Widget Monitor Picker
 *
 * The monitor checkbox list shared by the add and edit widget dialogs. In a
 * single profile it lists that profile's monitors. In an aggregate it lists
 * every in-scope server's monitors under a heading per server, so one widget
 * can hold monitors from several servers (refs #529). Picks are MonitorRefs
 * either way; the dialogs decide which shape to save.
 */

import { useMemo } from 'react';
import { Checkbox } from '../ui/checkbox';
import { ScrollArea } from '../ui/scroll-area';
import { useScopedMonitors } from '../../hooks/useScopedMonitors';
import { useProfileScope } from '../../hooks/useProfileScope';
import { groupByOwningProfile } from '../../lib/profile/profile-sections';
import { monitorCacheKey } from '../../stores/monitors';
import type { MonitorRef } from '../../stores/dashboard';

interface WidgetMonitorPickerProps {
    value: MonitorRef[];
    onChange: (refs: MonitorRef[]) => void;
    /** Checkbox testids are `${checkboxTestId}-${monitorId}`, with the profile id before the monitor id in an aggregate. */
    checkboxTestId: string;
    listTestId: string;
}

export function WidgetMonitorPicker({ value, onChange, checkboxTestId, listTestId }: WidgetMonitorPickerProps) {
    const scope = useProfileScope();
    const isAggregate = scope?.mode === 'all';
    const { monitors } = useScopedMonitors({ poll: false });
    const sections = useMemo(
        () => groupByOwningProfile(monitors.map((m) => ({ ...m, profileChip: m.profileName }))),
        [monitors]
    );
    const picked = new Set(value.map((ref) => monitorCacheKey(ref.profileId, ref.monitorId)));

    const toggle = (ref: MonitorRef) => {
        const key = monitorCacheKey(ref.profileId, ref.monitorId);
        onChange(picked.has(key)
            ? value.filter((r) => monitorCacheKey(r.profileId, r.monitorId) !== key)
            : [...value, ref]);
    };

    return (
        <ScrollArea className="h-48 border rounded-md" data-testid={listTestId}>
            <div className="p-3 space-y-2">
                {sections.map(([profileId, { profileName, items }]) => (
                    <div key={profileId} className="space-y-2">
                        {isAggregate && (
                            <p
                                className="text-xs font-semibold text-muted-foreground truncate"
                                title={profileName}
                                data-testid={`${listTestId}-server-${profileId}`}
                            >
                                {profileName}
                            </p>
                        )}
                        {items.map(({ item }) => {
                            const ref = { profileId, monitorId: item.Monitor.Id };
                            const suffix = isAggregate ? `${profileId}-${ref.monitorId}` : ref.monitorId;
                            const id = `${checkboxTestId}-${suffix}`;
                            return (
                                <div key={suffix} className="flex items-center gap-2 min-w-0">
                                    <Checkbox
                                        id={id}
                                        checked={picked.has(monitorCacheKey(profileId, ref.monitorId))}
                                        onCheckedChange={() => toggle(ref)}
                                        data-testid={id}
                                    />
                                    <label
                                        htmlFor={id}
                                        className="text-sm font-medium leading-none cursor-pointer min-w-0 truncate"
                                        title={item.Monitor.Name}
                                    >
                                        {item.Monitor.Name}
                                    </label>
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </ScrollArea>
    );
}
