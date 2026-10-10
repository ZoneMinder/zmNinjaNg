/**
 * Camera power row for the PTZ panel: Wake, Sleep, and Reboot, each shown only
 * when the control profile advertises it. Reboot asks first, since a stray tap
 * takes the camera offline.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Power, RotateCw, type LucideIcon } from 'lucide-react';
import { Button } from '../ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import type { ZMControl } from '../../api/types';

interface PTZPowerControlsProps {
  control: ZMControl;
  onCommand: (command: string) => void;
  disabled?: boolean;
}

export function PTZPowerControls({ control, onCommand, disabled }: PTZPowerControlsProps) {
  const { t } = useTranslation();
  const [confirmReboot, setConfirmReboot] = useState(false);

  const actions: { command: string; icon: LucideIcon; onClick: () => void }[] = [];
  if (control.CanWake === '1') actions.push({ command: 'wake', icon: Power, onClick: () => onCommand('wake') });
  if (control.CanSleep === '1') actions.push({ command: 'sleep', icon: Moon, onClick: () => onCommand('sleep') });
  if (control.CanReboot === '1') actions.push({ command: 'reboot', icon: RotateCw, onClick: () => setConfirmReboot(true) });
  if (actions.length === 0) return null;

  return (
    <div className="flex items-center gap-2 w-full justify-center border-t pt-4">
      {actions.map(({ command, icon: Icon, onClick }) => (
        <Button
          key={command}
          type="button"
          variant="outline"
          size="sm"
          className="flex-1 min-w-0"
          onClick={onClick}
          disabled={disabled}
          title={t(`ptz.${command}`)}
          data-testid={`ptz-${command}`}
        >
          <Icon className="h-4 w-4 mr-2 shrink-0" />
          <span className="truncate">{t(`ptz.${command}`)}</span>
        </Button>
      ))}

      <AlertDialog open={confirmReboot} onOpenChange={setConfirmReboot}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ptz.reboot_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('ptz.reboot_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="ptz-reboot-cancel">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => onCommand('reboot')} data-testid="ptz-reboot-confirm">
              {t('ptz.reboot')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
