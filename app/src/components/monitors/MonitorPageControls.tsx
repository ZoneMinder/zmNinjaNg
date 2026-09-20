/**
 * Page controls for a monitor list.
 *
 * Rendered only when there is more than one page, so a montage that fits on one
 * screen looks exactly as it did before paging existed. Icon-only buttons carry
 * a title and an aria-label, and the position is text rather than colour, per
 * the Controls contract.
 */

import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';

interface MonitorPageControlsProps {
  /** 1-based current page. */
  page: number;
  /** Total pages. */
  pages: number;
  onGoToPage: (page: number) => void;
  /** Distinguishes the montage's controls from the Monitors screen's in tests. */
  testIdPrefix: string;
}

export function MonitorPageControls({
  page,
  pages,
  onGoToPage,
  testIdPrefix,
}: MonitorPageControlsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1" data-testid={`${testIdPrefix}-page-controls`}>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={page <= 1}
        title={t('monitors.page_previous')}
        aria-label={t('monitors.page_previous')}
        onClick={() => onGoToPage(page - 1)}
        data-testid={`${testIdPrefix}-page-previous`}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {/* Not a live region: the tiles changing underneath is the announcement,
          and a polite region here would repeat it on every page turn. */}
      <span
        className="text-xs text-muted-foreground tabular-nums px-1"
        data-testid={`${testIdPrefix}-page-position`}
      >
        {t('monitors.page_position', { page, pages })}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={page >= pages}
        title={t('monitors.page_next')}
        aria-label={t('monitors.page_next')}
        onClick={() => onGoToPage(page + 1)}
        data-testid={`${testIdPrefix}-page-next`}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
