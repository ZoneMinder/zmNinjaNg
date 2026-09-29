/**
 * Grid Columns Menu
 *
 * Shared base for grid layout controls.
 * Mobile: bottom Sheet with preset buttons.
 * Desktop: DropdownMenu with preset items.
 * CustomColumnsDialog handles custom column entry; validation stays with the caller.
 */

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '../ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export interface GridPresetItem {
  cols: number;
  icon: LucideIcon;
  label: string;
  testId?: string;
}

export interface GridColumnsMenuProps {
  isMobile: boolean;
  gridCols: number;
  /** Trigger tooltip and sheet title. */
  title: string;
  triggerIcon: LucideIcon;
  /** Text beside the icon from `sm` up; omit for an icon-only trigger. */
  triggerLabel?: string;
  triggerTestId?: string;
  /** Render data-grid-cols on the trigger (used by e2e tests). */
  showGridColsAttr?: boolean;
  presets: GridPresetItem[];
  /** The custom entry is offered only when all three are given. */
  customIcon?: LucideIcon;
  customLabel?: string;
  onApplyGridLayout: (cols: number) => void;
  onCustomSelect?: () => void;
  /** Extra content at the end of the mobile sheet (e.g. saved layouts). */
  renderSheetExtras?: (closeSheet: () => void) => ReactNode;
  /** Extra items at the end of the desktop dropdown (e.g. saved layouts). */
  renderMenuExtras?: () => ReactNode;
}

export function GridColumnsMenu({
  isMobile,
  gridCols,
  title,
  triggerIcon: TriggerIcon,
  triggerLabel,
  triggerTestId,
  showGridColsAttr,
  presets,
  customIcon: CustomIcon,
  customLabel,
  onApplyGridLayout,
  onCustomSelect,
  renderSheetExtras,
  renderMenuExtras,
}: GridColumnsMenuProps) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const custom = CustomIcon && customLabel && onCustomSelect ? { Icon: CustomIcon, label: customLabel, onSelect: onCustomSelect } : null;
  const triggerContent = triggerLabel ? (
    <>
      <TriggerIcon className="h-4 w-4 sm:mr-2" />
      <span className="hidden sm:inline">{triggerLabel}</span>
    </>
  ) : (
    <TriggerIcon className="h-4 w-4" />
  );

  if (isMobile) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          title={title}
          aria-label={triggerLabel ? undefined : title}
          className="h-8 sm:h-9"
          data-testid={triggerTestId}
          data-grid-cols={showGridColsAttr ? gridCols : undefined}
          onClick={() => setIsSheetOpen(true)}
        >
          {triggerContent}
        </Button>
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
            </SheetHeader>
            <div className="grid gap-2 py-4">
              {presets.map(({ cols, icon: Icon, label, testId }) => (
                <Button
                  key={cols}
                  variant={gridCols === cols ? 'default' : 'outline'}
                  aria-pressed={gridCols === cols}
                  data-testid={testId}
                  onClick={() => {
                    onApplyGridLayout(cols);
                    setIsSheetOpen(false);
                  }}
                  className="justify-start"
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {label}
                </Button>
              ))}
              {custom && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsSheetOpen(false);
                    custom.onSelect();
                  }}
                  className="justify-start"
                >
                  <custom.Icon className="h-4 w-4 mr-2" />
                  {custom.label}
                </Button>
              )}
              {renderSheetExtras?.(() => setIsSheetOpen(false))}
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          title={title}
          aria-label={triggerLabel ? undefined : title}
          className="h-8 sm:h-9"
          data-testid={triggerTestId}
          data-grid-cols={showGridColsAttr ? gridCols : undefined}
        >
          {triggerContent}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {presets.map(({ cols, icon: Icon, label, testId }) => (
          <DropdownMenuItem
            key={cols}
            data-testid={testId}
            onClick={() => onApplyGridLayout(cols)}
          >
            <Icon className="h-4 w-4 mr-2" />
            {label}
          </DropdownMenuItem>
        ))}
        {custom && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={custom.onSelect}>
              <custom.Icon className="h-4 w-4 mr-2" />
              {custom.label}
            </DropdownMenuItem>
          </>
        )}
        {renderMenuExtras?.()}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface CustomColumnsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  title: string;
  description: string;
  columnsLabel: string;
  applyLabel: string;
}

export function CustomColumnsDialog({
  open,
  onOpenChange,
  value,
  onValueChange,
  onSubmit,
  title,
  description,
  columnsLabel,
  applyLabel,
}: CustomColumnsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="custom-cols">{columnsLabel}</Label>
            <Input
              id="custom-cols"
              type="number"
              min="1"
              max="10"
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onSubmit();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSubmit}>{applyLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
