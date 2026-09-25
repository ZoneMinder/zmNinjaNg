/**
 * Widget Edit Dialog Component
 *
 * Provides a dialog for editing existing dashboard widgets.
 * Features:
 * - Edit widget title
 * - Change monitor selection for monitor widgets
 * - Object detection and tag filters for events widgets
 * - Update widget settings
 * - Form validation
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import type { ProfileId } from '../../api/types';
import type { DashboardWidget, MonitorRef } from '../../stores/dashboard';
import type { MonitorFeedFit } from '../../stores/settings';
import { useDashboardStore } from '../../stores/dashboard';
import { useProfileScope } from '../../hooks/useProfileScope';
import { useScopedMonitors } from '../../hooks/useScopedMonitors';
import { monitorCacheKey } from '../../stores/monitors';
import { widgetMonitorRefs, withMonitorRefs } from '../../lib/monitor/widget-monitor-refs';
import { WidgetMonitorPicker } from './WidgetMonitorPicker';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { ScrollArea } from '../ui/scroll-area';
import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useEventTags } from '../../hooks/useEventTags';
import { ALL_TAGS_FILTER_ID } from '../../hooks/useEventFilters';
import { cn } from '../../lib/utils';
import { X, GripVertical } from 'lucide-react';

interface WidgetEditDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    widget: DashboardWidget;
    profileId: ProfileId;
}

export function WidgetEditDialog({ open, onOpenChange, widget, profileId }: WidgetEditDialogProps) {
    const { t } = useTranslation();
    const scope = useProfileScope();
    const isAllMode = scope?.mode === 'all';
    // Picks carry their owning server. A single profile's bare ids, and a
    // legacy aggregate widget's, read as refs on the first profile in scope
    // unless the widget stored its own (refs #529).
    const readPicks = () => widgetMonitorRefs(widget.settings, scope?.profiles[0]?.id);
    const [title, setTitle] = useState(widget.title);
    const [picks, setPicks] = useState<MonitorRef[]>(readPicks);
    const [feedFit, setFeedFit] = useState<MonitorFeedFit>((widget.settings.feedFit as MonitorFeedFit) || 'contain');
    const [onlyDetectedObjects, setOnlyDetectedObjects] = useState(widget.settings.onlyDetectedObjects || false);
    const [selectedTagIds, setSelectedTagIds] = useState<string[]>(widget.settings.tagIds || []);
    const updateWidget = useDashboardStore((state) => state.updateWidget);

    // Names for the order list, which can mix servers in an aggregate.
    const { monitors } = useScopedMonitors({ poll: false });
    const nameByKey = useMemo(
        () => new Map(monitors.map((m) => [monitorCacheKey(m.profileId, m.item.Monitor.Id), m.item.Monitor.Name])),
        [monitors]
    );

    const { availableTags, tagsSupported } = useEventTags(scope?.profiles[0]?.id);

    const isAllTagsSelected = selectedTagIds.includes(ALL_TAGS_FILTER_ID);

    // Reset form when widget changes
    useEffect(() => {
        setTitle(widget.title);
        setPicks(readPicks());
        setFeedFit((widget.settings.feedFit as MonitorFeedFit) || 'contain');
        setOnlyDetectedObjects(widget.settings.onlyDetectedObjects || false);
        setSelectedTagIds(widget.settings.tagIds || []);
        // scope is intentionally omitted: re-deriving the picks on every
        // scope tick would fight the user's edits.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [widget]);

    // Drag-to-reorder state
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dragOffsetY, setDragOffsetY] = useState(0);
    const dragOriginY = useRef(0);
    const orderListRef = useRef<HTMLDivElement>(null);

    const handlePointerDown = useCallback((e: React.PointerEvent, index: number) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setDragIndex(index);
        setDragOffsetY(0);
        dragOriginY.current = e.clientY;
    }, []);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (dragIndex === null || !orderListRef.current) return;
        setDragOffsetY(e.clientY - dragOriginY.current);
        const items = orderListRef.current.querySelectorAll('[data-monitor-reorder]');
        for (let i = 0; i < items.length; i++) {
            if (i === dragIndex) continue;
            const rect = items[i].getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
                if ((i < dragIndex && e.clientY < midY) || (i > dragIndex && e.clientY > midY)) {
                    setPicks((prev) => {
                        const next = [...prev];
                        [next[dragIndex], next[i]] = [next[i], next[dragIndex]];
                        return next;
                    });
                    setDragIndex(i);
                    dragOriginY.current = e.clientY;
                    setDragOffsetY(0);
                }
                return;
            }
        }
    }, [dragIndex]);

    const handlePointerUp = useCallback(() => {
        setDragIndex(null);
        setDragOffsetY(0);
    }, []);

    /**
     * Toggle tag selection
     */
    const toggleTag = (tagId: string) => {
        if (tagId === ALL_TAGS_FILTER_ID) {
            setSelectedTagIds(isAllTagsSelected ? [] : [ALL_TAGS_FILTER_ID]);
            return;
        }
        // Selecting individual tag deselects "All"
        setSelectedTagIds((prev) => {
            const withoutAll = prev.filter((id) => id !== ALL_TAGS_FILTER_ID);
            return withoutAll.includes(tagId)
                ? withoutAll.filter((id) => id !== tagId)
                : [...withoutAll, tagId];
        });
    };

    /**
     * Handle saving widget updates
     */
    const handleSave = () => {
        // An aggregate saves each pick with its owning server (refs #529).
        const updatedSettings = isAllMode
            ? withMonitorRefs(widget.settings, picks)
            : { ...widget.settings, monitorIds: picks.map((p) => p.monitorId) };

        if (widget.type === 'monitor') {
            updatedSettings.feedFit = feedFit;
        } else if (widget.type === 'events') {
            updatedSettings.onlyDetectedObjects = onlyDetectedObjects;
            updatedSettings.tagIds = selectedTagIds;
        }

        updateWidget(profileId, widget.id, {
            title,
            settings: updatedSettings,
        });

        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md" data-testid="widget-edit-dialog">
                <DialogHeader>
                    <DialogTitle>{t('dashboard.edit_layout')}</DialogTitle>
                    <DialogDescription className="sr-only">
                        Edit dashboard widget settings.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Widget Title */}
                    <div className="space-y-2">
                        <Label htmlFor="widget-title">{t('dashboard.widget_title')}</Label>
                        <Input
                            id="widget-title"
                            placeholder={t('dashboard.widget_title_placeholder')}
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            data-testid="widget-edit-title-input"
                        />
                    </div>

                    {/* Monitor Selection (for monitor and events widgets) */}
                    {(widget.type === 'monitor' || widget.type === 'events') && (
                        <div className="space-y-2">
                            <Label>
                                {t('dashboard.select_monitors')}
                            </Label>
                            <WidgetMonitorPicker
                                value={picks}
                                onChange={setPicks}
                                checkboxTestId="widget-edit-monitor-checkbox"
                                listTestId="widget-edit-monitor-list"
                            />
                            {widget.type === 'monitor' && picks.length === 0 && (
                                <p className="text-xs text-muted-foreground text-red-500">
                                    {t('dashboard.monitor_required')}
                                </p>
                            )}
                            {picks.length > 1 && (
                                <div className="space-y-1 mt-2">
                                    <Label className="text-xs text-muted-foreground">{t('dashboard.monitor_order')}</Label>
                                    <div ref={orderListRef} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
                                        {picks.map((pick, index) => {
                                            const id = pick.monitorId;
                                            // Single mode keeps its bare-id keys and testids.
                                            const key = monitorCacheKey(isAllMode ? pick.profileId : undefined, id);
                                            const isDragging = dragIndex === index;
                                            return (
                                                <div
                                                    key={key}
                                                    data-monitor-reorder
                                                    onPointerDown={(e) => handlePointerDown(e, index)}
                                                    className={cn(
                                                        "flex items-center gap-2 px-2 py-1.5 rounded text-sm select-none touch-none mb-1",
                                                        isDragging
                                                            ? "bg-primary/15 shadow-md z-10 relative scale-[1.02]"
                                                            : "bg-muted/30 cursor-grab"
                                                    )}
                                                    style={isDragging ? { transform: `translateY(${dragOffsetY}px) scale(1.02)` } : undefined}
                                                    data-testid={`widget-edit-monitor-reorder-${key}`}
                                                >
                                                    <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                                                    <span className="flex-1 truncate">{nameByKey.get(monitorCacheKey(pick.profileId, id)) || `Monitor ${id}`}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Feed Fit (monitor widgets only) */}
                    {widget.type === 'monitor' && (
                        <div className="space-y-2">
                            <Label>{t('dashboard.feed_fit')}</Label>
                            <Select value={feedFit} onValueChange={(value) => setFeedFit(value as MonitorFeedFit)}>
                                <SelectTrigger data-testid="widget-edit-feed-fit-select">
                                    <SelectValue placeholder={t('dashboard.feed_fit')} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="contain" data-testid="widget-edit-fit-contain">
                                        {t('montage.fit_fit')}
                                    </SelectItem>
                                    <SelectItem value="cover" data-testid="widget-edit-fit-cover">
                                        {t('montage.fit_crop')}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {/* Events widget filters */}
                    {widget.type === 'events' && (
                        <>
                            {/* Only Detected Objects toggle */}
                            <div className="flex items-center justify-between p-3 rounded-md border bg-card">
                                <Label htmlFor="widget-only-detected" className="cursor-pointer text-sm">
                                    {t('events.filter.onlyDetectedObjects')}
                                </Label>
                                <Switch
                                    id="widget-only-detected"
                                    checked={onlyDetectedObjects}
                                    onCheckedChange={setOnlyDetectedObjects}
                                    data-testid="widget-edit-detected-toggle"
                                />
                            </div>

                            {/* Tag filter */}
                            {tagsSupported && availableTags.length > 0 && (
                                <div className="space-y-2">
                                    <Label>{t('events.filter.tags')}</Label>
                                    <ScrollArea className="h-32 border rounded-md" data-testid="widget-edit-tag-list">
                                        <div className="p-2 space-y-1">
                                            {/* "All Tagged" option */}
                                            <button
                                                type="button"
                                                onClick={() => toggleTag(ALL_TAGS_FILTER_ID)}
                                                className={cn(
                                                    'w-full text-left px-2 py-1.5 rounded text-sm transition-colors flex items-center justify-between font-medium',
                                                    isAllTagsSelected
                                                        ? 'bg-primary/10 text-primary'
                                                        : 'hover:bg-muted'
                                                )}
                                                data-testid="widget-edit-tag-all"
                                            >
                                                <span>{t('events.filter.allTags')}</span>
                                                {isAllTagsSelected && (
                                                    <X className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                                                )}
                                            </button>
                                            {/* Individual tags */}
                                            {availableTags.map((tag) => {
                                                const isSelected = selectedTagIds.includes(tag.Id);
                                                return (
                                                    <button
                                                        key={tag.Id}
                                                        type="button"
                                                        onClick={() => toggleTag(tag.Id)}
                                                        className={cn(
                                                            'w-full text-left px-2 py-1.5 rounded text-sm transition-colors flex items-center justify-between',
                                                            isSelected
                                                                ? 'bg-primary/10 text-primary'
                                                                : isAllTagsSelected
                                                                    ? 'opacity-50 cursor-not-allowed'
                                                                    : 'hover:bg-muted'
                                                        )}
                                                        disabled={isAllTagsSelected}
                                                        data-testid={`widget-edit-tag-${tag.Id}`}
                                                    >
                                                        <span className="truncate">{tag.Name}</span>
                                                        {isSelected && (
                                                            <X className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </ScrollArea>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="widget-edit-cancel-button">
                        {t('dashboard.cancel')}
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={
                            (widget.type === 'monitor' && picks.length === 0)
                        }
                        data-testid="widget-edit-save-button"
                    >
                        {t('common.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
