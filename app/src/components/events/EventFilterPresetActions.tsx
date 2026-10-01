/**
 * Save, load and delete for Events filter presets (refs #544), shown beside
 * the filter panel's heading. Delete only appears while a preset is loaded,
 * and only deletes after a confirmation.
 */

import { FolderOpen, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

interface EventFilterPresetActionsProps {
  names: string[];
  /** The loaded preset, '' when none is. */
  activeName: string;
  onSave: (name: string) => void;
  onLoad: (name: string) => void;
  onDelete: () => void;
}

export function EventFilterPresetActions({ names, activeName, onSave, onLoad, onDelete }: EventFilterPresetActionsProps) {
  const { t } = useTranslation();
  const [saveOpen, setSaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState('');
  const trimmed = name.trim();

  const openSave = () => {
    setName(activeName);
    setSaveOpen(true);
  };

  const confirmSave = () => {
    if (!trimmed) return;
    onSave(trimmed);
    setSaveOpen(false);
  };

  return (
    <div className="flex items-center gap-1 min-w-0">
      {activeName && (
        <span
          className="text-xs text-muted-foreground truncate max-w-[8rem]"
          title={activeName}
          data-testid="events-filter-preset-active"
        >
          {activeName}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={openSave}
        title={t('events.filter_preset_save')}
        aria-label={t('events.filter_preset_save')}
        data-testid="events-filter-preset-save"
      >
        <Save className="h-4 w-4" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={names.length === 0}
            title={t('events.filter_preset_load')}
            aria-label={t('events.filter_preset_load')}
            data-testid="events-filter-preset-load"
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-[16rem]">
          {names.map((preset) => (
            <DropdownMenuItem
              key={preset}
              onSelect={() => onLoad(preset)}
              className={preset === activeName ? 'font-semibold' : undefined}
              data-testid={`events-filter-preset-item-${preset}`}
            >
              <span className="truncate" title={preset}>{preset}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {activeName && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setDeleteOpen(true)}
          title={t('events.filter_preset_delete')}
          aria-label={t('events.filter_preset_delete')}
          data-testid="events-filter-preset-delete"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('events.filter_preset_save')}</DialogTitle>
            <DialogDescription>{t('events.filter_preset_save_desc')}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              confirmSave();
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('events.filter_preset_name')}
              aria-label={t('events.filter_preset_name')}
              data-testid="events-filter-preset-name"
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setSaveOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!trimmed} data-testid="events-filter-preset-save-confirm">
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('events.filter_preset_delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('events.filter_preset_delete_desc', { name: activeName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} data-testid="events-filter-preset-delete-confirm">
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
