import { MoreVertical, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
} from '../ui/dropdown-menu';
import { cn } from '../../lib/utils';
import type { Monitor } from '../../api/types';

interface MontageKebabMenuProps {
  monitors: Monitor[];
  hiddenMonitorIds: string[];
  isRefreshing: boolean;
  onRefresh: () => void;
  onToggleVisibility: (monitorId: string) => void;
}

export function MontageKebabMenu({
  monitors,
  hiddenMonitorIds,
  isRefreshing,
  onRefresh,
  onToggleVisibility,
}: MontageKebabMenuProps) {
  const { t } = useTranslation();

  const hiddenSet = useMemo(() => new Set(hiddenMonitorIds), [hiddenMonitorIds]);

  const sortedMonitors = useMemo(() => {
    return [...monitors].sort((a, b) => {
      const sa = Number(a.Sequence ?? 0);
      const sb = Number(b.Sequence ?? 0);
      if (sa !== sb) return sa - sb;
      return (a.Name ?? '').localeCompare(b.Name ?? '');
    });
  }, [monitors]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 sm:h-9 px-2"
          aria-label={t('montage.menu_more')}
          title={t('montage.menu_more')}
          data-testid="montage-kebab-menu"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={onRefresh}
          disabled={isRefreshing}
          data-testid="montage-kebab-refresh"
        >
          <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} />
          {t('montage.menu_refresh')}
        </DropdownMenuItem>
        {sortedMonitors.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid="montage-kebab-visibility">
                {t('montage.menu_show_monitors')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[min(60vh,24rem)] overflow-y-auto">
                {sortedMonitors.map((m) => {
                  const visible = !hiddenSet.has(m.Id);
                  return (
                    <DropdownMenuCheckboxItem
                      key={m.Id}
                      checked={visible}
                      onSelect={(e) => {
                        e.preventDefault();
                        onToggleVisibility(m.Id);
                      }}
                      data-testid={`montage-visibility-${m.Id}`}
                    >
                      {m.Name}
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
