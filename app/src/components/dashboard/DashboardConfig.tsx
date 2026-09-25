/**
 * Dashboard Configuration Component
 *
 * Provides a dialog for adding new widgets to the dashboard.
 * Features:
 * - Widget type selection (monitor, events, timeline, heatmap)
 * - Monitor selection for monitor widgets
 * - Custom widget titles
 * - Form validation
 * - Profile-aware widget creation
 */

import { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogTrigger,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Plus, Video, Clock, ChartGantt, TrendingUp } from 'lucide-react';
import type { DashboardWidget, MonitorRef, WidgetType } from '../../stores/dashboard';
import type { MonitorFeedFit } from '../../stores/settings';
import { useDashboardStore } from '../../stores/dashboard';
import { useCurrentProfile } from '../../hooks/useCurrentProfile';
import { useProfileScope } from '../../hooks/useProfileScope';
import { asProfileId } from '../../api/types';
import { useScopedMonitors } from '../../hooks/useScopedMonitors';
import { WidgetMonitorPicker } from './WidgetMonitorPicker';
import { GRID_LAYOUT } from '../../lib/zmninja-ng-constants';
import { activateOnEnterOrSpace } from '../../lib/utils';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';
import { useTranslation } from 'react-i18next';

export function DashboardConfig() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [selectedType, setSelectedType] = useState<WidgetType>('monitor');
    const [picks, setPicks] = useState<MonitorRef[]>([]);
    const [title, setTitle] = useState('');
    const [feedFit, setFeedFit] = useState<MonitorFeedFit>('contain');
    const addWidget = useDashboardStore((state) => state.addWidget);
    const { currentProfile } = useCurrentProfile();
    const scope = useProfileScope();
    const isAllMode = scope?.mode === 'all';
    // Boundary: 'default' is a synthesized placeholder key for the
    // no-profile-selected case (dashboard widget storage keys still need a
    // key). Not a real profile id, so it must be minted explicitly. Each
    // aggregate gets its own bucket instead of colliding with 'default' or
    // with another aggregate (refs #337).
    const profileId = scope?.mode === 'all'
        ? scope.aggregateId
        : (currentProfile?.id ?? asProfileId('default'));

    // Single mode's events widget picks one monitor from a dropdown; the
    // picker lists the same monitors for the other cases. One profile is in
    // scope there, so every listed monitor shares its profileId.
    const { monitors: scopedMonitors } = useScopedMonitors({ poll: false });

    /**
     * Get default title for a widget type
     */
    const getDefaultTitle = (type: WidgetType): string => {
        switch (type) {
            case 'monitor':
                return t('dashboard.widget_monitor');
            case 'events':
                return t('dashboard.widget_events');
            case 'timeline':
                return t('dashboard.widget_timeline');
            case 'heatmap':
                return t('dashboard.widget_heatmap');
            default:
                return '';
        }
    };

    /**
     * Get default layout dimensions for a widget type
     * Includes minimum width/height constraints to prevent content overflow
     */
    const getDefaultLayout = (type: WidgetType, monitorCount: number = 1) => {
        // All widgets start at full width. Users can resize narrower in edit mode.
        // minW prevents resizing below a usable size for each widget type.
        switch (type) {
            case 'monitor': {
                const monitorMinW = monitorCount === 1 ? 4 : monitorCount <= 4 ? 6 : 8;
                return { w: GRID_LAYOUT.cols, h: 2, minW: monitorMinW, minH: 2 };
            }
            case 'timeline':
                return { w: GRID_LAYOUT.cols, h: 3, minW: 6, minH: 3 };
            case 'heatmap':
                return { w: GRID_LAYOUT.cols, h: 3, minW: 6, minH: 3 };
            case 'events':
            default:
                return { w: GRID_LAYOUT.cols, h: 2, minW: 3, minH: 2 };
        }
    };

    /**
     * Get widget settings based on type and monitor selection
     */
    const getWidgetSettings = (type: WidgetType, refs: MonitorRef[], fit: MonitorFeedFit) => {
        const settings: DashboardWidget['settings'] = {};

        // An aggregate saves each pick with its owning server - a monitorId
        // only means something on one server (refs #529).
        if (type === 'monitor') {
            if (isAllMode) settings.monitorRefs = refs;
            else settings.monitorIds = refs.map((r) => r.monitorId);
            settings.feedFit = fit;
        } else if (type === 'events') {
            if (isAllMode) settings.monitorRefs = refs;
            else settings.monitorId = refs[0]?.monitorId;
            settings.eventCount = 5;
        }

        return settings;
    };

    /**
     * Handle adding a new widget to the dashboard
     */
    const handleAdd = () => {
        // Validation: Monitor widgets require at least one monitor
        if (selectedType === 'monitor' && picks.length === 0) {
            return;
        }

        addWidget(profileId, {
            type: selectedType,
            title: title || getDefaultTitle(selectedType),
            settings: getWidgetSettings(selectedType, picks, feedFit),
            layout: getDefaultLayout(selectedType, picks.length),
        });

        setOpen(false);
        resetForm();
    };

    /**
     * Reset the form to default state
     */
    const resetForm = () => {
        setSelectedType('monitor');
        setPicks([]);
        setTitle('');
        setFeedFit('contain');
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button title={t('dashboard.add_widget')} data-testid="add-widget-trigger">
                    <Plus className="sm:mr-2 h-4 w-4" />
                    <span className="hidden sm:inline">{t('dashboard.add_widget')}</span>
                </Button>
            </DialogTrigger>
            <DialogContent data-testid="add-widget-dialog">
                <DialogHeader>
                    <DialogTitle>{t('dashboard.add_widget')}</DialogTitle>
                    <DialogDescription className="sr-only">
                        Add a new widget to the dashboard.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div
                        className="grid grid-cols-2 sm:grid-cols-4 gap-4"
                        role="radiogroup"
                        aria-label={t('dashboard.widget_type')}
                    >
                        <div
                            className={`p-4 border rounded-lg cursor-pointer hover:bg-muted/50 flex flex-col items-center gap-2 ${selectedType === 'monitor' ? 'border-primary bg-primary/5' : ''}`}
                            role="radio"
                            aria-checked={selectedType === 'monitor'}
                            tabIndex={0}
                            onClick={() => setSelectedType('monitor')}
                            onKeyDown={activateOnEnterOrSpace(() => setSelectedType('monitor'))}
                            data-testid="widget-type-monitor"
                        >
                            <Video className="h-8 w-8" />
                            <span className="font-medium text-xs text-center">{t('dashboard.widget_monitor')}</span>
                        </div>
                        <div
                            className={`p-4 border rounded-lg cursor-pointer hover:bg-muted/50 flex flex-col items-center gap-2 ${selectedType === 'events' ? 'border-primary bg-primary/5' : ''}`}
                            role="radio"
                            aria-checked={selectedType === 'events'}
                            tabIndex={0}
                            onClick={() => setSelectedType('events')}
                            onKeyDown={activateOnEnterOrSpace(() => setSelectedType('events'))}
                            data-testid="widget-type-events"
                        >
                            <Clock className="h-8 w-8" />
                            <span className="font-medium text-xs text-center">{t('dashboard.widget_events')}</span>
                        </div>
                        <div
                            className={`p-4 border rounded-lg cursor-pointer hover:bg-muted/50 flex flex-col items-center gap-2 ${selectedType === 'timeline' ? 'border-primary bg-primary/5' : ''}`}
                            role="radio"
                            aria-checked={selectedType === 'timeline'}
                            tabIndex={0}
                            onClick={() => setSelectedType('timeline')}
                            onKeyDown={activateOnEnterOrSpace(() => setSelectedType('timeline'))}
                            data-testid="widget-type-timeline"
                        >
                            <ChartGantt className="h-8 w-8" />
                            <span className="font-medium text-xs text-center">{t('dashboard.widget_timeline')}</span>
                        </div>
                        <div
                            className={`p-4 border rounded-lg cursor-pointer hover:bg-muted/50 flex flex-col items-center gap-2 ${selectedType === 'heatmap' ? 'border-primary bg-primary/5' : ''}`}
                            role="radio"
                            aria-checked={selectedType === 'heatmap'}
                            tabIndex={0}
                            onClick={() => setSelectedType('heatmap')}
                            onKeyDown={activateOnEnterOrSpace(() => setSelectedType('heatmap'))}
                            data-testid="widget-type-heatmap"
                        >
                            <TrendingUp className="h-8 w-8" />
                            <span className="font-medium text-xs text-center">{t('dashboard.widget_heatmap')}</span>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="widget-title">{t('dashboard.widget_title')}</Label>
                        <Input
                            id="widget-title"
                            placeholder={t('dashboard.widget_title_placeholder')}
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            data-testid="widget-title-input"
                        />
                    </div>

                    {(selectedType === 'monitor' || (isAllMode && selectedType === 'events')) && (
                        <div className="space-y-2">
                            <Label>{t('dashboard.select_monitors')}</Label>
                            <WidgetMonitorPicker
                                value={picks}
                                onChange={setPicks}
                                checkboxTestId="monitor-checkbox"
                                listTestId="monitor-selection-list"
                            />
                            {selectedType === 'monitor' && picks.length === 0 && (
                                <p className="text-xs text-destructive">{t('dashboard.monitor_required')}</p>
                            )}
                        </div>
                    )}
                    {selectedType === 'monitor' && (
                        <div className="space-y-2">
                            <Label>{t('dashboard.feed_fit')}</Label>
                            <Select value={feedFit} onValueChange={(value) => setFeedFit(value as MonitorFeedFit)}>
                                <SelectTrigger data-testid="dashboard-monitor-feed-fit-select">
                                    <SelectValue placeholder={t('dashboard.feed_fit')} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="contain" data-testid="dashboard-monitor-fit-contain">
                                        {t('montage.fit_fit')}
                                    </SelectItem>
                                    <SelectItem value="cover" data-testid="dashboard-monitor-fit-cover">
                                        {t('montage.fit_crop')}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {!isAllMode && selectedType === 'events' && (
                        <div className="space-y-2">
                            <Label>{t('dashboard.select_monitor')}</Label>
                            <Select
                                value={picks[0]?.monitorId || 'all'}
                                onValueChange={(val) => setPicks(val === 'all' ? [] : [{ profileId: scopedMonitors[0].profileId, monitorId: val }])}
                            >
                                <SelectTrigger data-testid="events-monitor-select">
                                    <SelectValue placeholder={t('dashboard.select_monitor')} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">{t('dashboard.all_monitors')}</SelectItem>
                                    {scopedMonitors.map(({ item: m }) => (
                                        <SelectItem key={m.Monitor.Id} value={m.Monitor.Id}>
                                            {m.Monitor.Name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setOpen(false)} data-testid="widget-cancel-button">{t('dashboard.cancel')}</Button>
                    <Button onClick={handleAdd} disabled={selectedType === 'monitor' && picks.length === 0} data-testid="widget-add-button">
                        {t('dashboard.add')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
