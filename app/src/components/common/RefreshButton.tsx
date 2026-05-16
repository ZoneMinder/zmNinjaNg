/**
 * RefreshButton: shared refresh control used across data pages.
 * Wraps the Button + RefreshCw icon pattern with optional spin and i18n label.
 */

import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

export type RefreshButtonShowLabel = 'always' | 'never' | 'sm-and-up';

export interface RefreshButtonProps {
  onRefresh: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  label?: string;
  showLabel?: RefreshButtonShowLabel;
  size?: 'sm' | 'icon';
  className?: string;
  'data-testid'?: string;
  'aria-label'?: string;
}

export function RefreshButton({
  onRefresh,
  isLoading = false,
  disabled = false,
  label,
  showLabel = 'never',
  size = 'icon',
  className,
  'data-testid': testId = 'refresh-button',
  'aria-label': ariaLabel,
}: RefreshButtonProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('common.refresh');

  const labelClass =
    showLabel === 'always'
      ? ''
      : showLabel === 'sm-and-up'
        ? 'hidden sm:inline'
        : 'sr-only';

  const iconMarginClass =
    showLabel === 'always'
      ? 'mr-2'
      : showLabel === 'sm-and-up'
        ? 'sm:mr-2'
        : '';

  return (
    <Button
      type="button"
      onClick={onRefresh}
      variant="outline"
      size={size}
      disabled={disabled || isLoading}
      title={resolvedLabel}
      aria-label={ariaLabel ?? resolvedLabel}
      className={cn(className)}
      data-testid={testId}
    >
      <RefreshCw
        className={cn('h-4 w-4', iconMarginClass, isLoading && 'animate-spin')}
      />
      <span className={labelClass}>{resolvedLabel}</span>
    </Button>
  );
}
