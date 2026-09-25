/**
 * Dashboard Page Component
 *
 * Main dashboard page that displays customizable widgets for monitoring
 * cameras and events. Supports:
 * - Profile-specific dashboards
 * - Multiple widget types (monitor, events, timeline)
 * - Drag-and-drop layout customization
 * - Edit mode for widget management
 */

import { LayoutDashboard, Pencil, Check } from 'lucide-react';
import { Button } from '../components/ui/button';
import { RefreshButton } from '../components/common/RefreshButton';
import { DashboardLayout } from '../components/dashboard/DashboardLayout';
import { DashboardConfig } from '../components/dashboard/DashboardConfig';
import { useDashboardStore } from '../stores/dashboard';
import { useCurrentProfile } from '../hooks/useCurrentProfile';
import { useProfileScope } from '../hooks/useProfileScope';
import { asProfileId } from '../api/types';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { NotificationBadge } from '../components/NotificationBadge';
import { NinjiiToolbarButton } from '../components/assistant/NinjiiToolbarButton';
import { GroupByServerToggle } from '../components/profiles/GroupByServerToggle';

export default function Dashboard() {
    const { t } = useTranslation();
    const isEditing = useDashboardStore((state) => state.isEditing);
    const toggleEditMode = useDashboardStore((state) => state.toggleEditMode);
    const { currentProfile } = useCurrentProfile();
    const scope = useProfileScope();
    // Boundary: 'default' is a synthesized placeholder key for the
    // no-profile-selected case; each aggregate gets its own bucket (All
    // Servers under its sentinel, a group under its own id, refs #337)
    // rather than colliding with 'default' or with each other.
    const profileId = scope?.mode === 'all'
        ? scope.aggregateId
        : (currentProfile?.id ?? asProfileId('default'));
    const widgets = useDashboardStore(
        useShallow((state) => state.widgets[profileId] ?? [])
    );

    return (
        <div className="flex flex-col h-full bg-background">
            <div className="flex items-center justify-between p-4 border-b">
                <div className="flex items-center gap-2">
                    <LayoutDashboard className="h-4 w-4 sm:h-5 sm:w-5" />
                    <h1 className="text-base sm:text-lg font-bold">{t('dashboard.title')}</h1>
                    <NotificationBadge />
                </div>
                <div className="flex items-center gap-2">
                    {widgets.length > 0 && (
                        <>
                            <GroupByServerToggle setting="eventsGroupByServer" testId="dashboard-group-by-server" />
                            <NinjiiToolbarButton />
                            <RefreshButton size="sm" data-testid="dashboard-refresh-button" />
                            <Button
                                variant={isEditing ? "default" : "outline"}
                                aria-pressed={isEditing}
                                size="sm"
                                onClick={toggleEditMode}
                                className={isEditing ? "bg-green-600 hover:bg-green-700" : ""}
                                title={isEditing ? t('dashboard.done') : t('dashboard.edit_layout')}
                                data-testid="dashboard-edit-toggle"
                            >
                                {isEditing ? (
                                    <>
                                        <Check className="sm:mr-2 h-4 w-4" />
                                        <span className="hidden sm:inline">{t('dashboard.done')}</span>
                                    </>
                                ) : (
                                    <>
                                        <Pencil className="sm:mr-2 h-4 w-4" />
                                        <span className="hidden sm:inline">{t('dashboard.edit_layout')}</span>
                                    </>
                                )}
                            </Button>
                        </>
                    )}
                    <DashboardConfig />
                </div>
            </div>

            <div className="flex-1 overflow-auto bg-muted/10 w-full">
                <DashboardLayout />
            </div>
        </div>
    );
}
