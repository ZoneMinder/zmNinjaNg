/**
 * PageContainer: shared page wrapper applying the standard responsive padding.
 * Spacing prop maps to fixed space-y classes; pass className for responsive variants.
 */

import { forwardRef, type ReactNode, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export type PageContainerSpacing = 'tight' | 'normal' | 'loose' | 'none';

const SPACING_CLASS: Record<PageContainerSpacing, string> = {
  none: '',
  tight: 'space-y-3',
  normal: 'space-y-4',
  loose: 'space-y-6',
};

export interface PageContainerProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  spacing?: PageContainerSpacing;
  className?: string;
}

export const PageContainer = forwardRef<HTMLDivElement, PageContainerProps>(
  ({ children, spacing = 'normal', className, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('p-3 sm:p-4 md:p-6', SPACING_CLASS[spacing], className)}
        {...rest}
      >
        {children}
      </div>
    );
  }
);

PageContainer.displayName = 'PageContainer';
