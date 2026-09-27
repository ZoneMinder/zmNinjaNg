/**
 * Event thumbnails: the order in which event thumbnail sources are tried. A
 * fold inside one card row; it opens while searching so its rows can match.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { RowLabel } from './SettingsLayout';
import { useSettingsSearching } from './settings-search';
import { cn } from '../../lib/utils';
import { STORAGE_KEYS } from '../../lib/zmninja-ng-constants';
import type { ThumbnailFallbackEntry, ThumbnailFallbackType } from '../../stores/settings';

interface ThumbnailFallbackChainEditorProps {
  chain: ThumbnailFallbackEntry[];
  onChange: (next: ThumbnailFallbackEntry[]) => void;
}

export function ThumbnailFallbackChainEditor({ chain, onChange }: ThumbnailFallbackChainEditorProps) {
  const { t } = useTranslation();
  const safeChain = Array.isArray(chain) ? chain : [];
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.thumbnailChainOpen) === 'true';
    } catch { return false; }
  });

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    try { localStorage.setItem(STORAGE_KEYS.thumbnailChainOpen, String(value)); } catch { /* ignore */ }
  };

  const getLabel = (type: ThumbnailFallbackType): string => {
    switch (type) {
      case 'alarm':
        return t('settings.appearance.thumbnail_chain.alarm');
      case 'snapshot':
        return t('settings.appearance.thumbnail_chain.snapshot');
      case 'objdetect':
        return t('settings.appearance.thumbnail_chain.objdetect');
      case 'custom':
        return t('settings.appearance.thumbnail_chain.custom');
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= safeChain.length) return;
    const next = [...safeChain];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const toggle = (index: number, enabled: boolean) => {
    const next = safeChain.map((entry, i) => (i === index ? { ...entry, enabled } : entry));
    onChange(next);
  };

  const setCustomFid = (index: number, customFid: string) => {
    const next = safeChain.map((entry, i) => (i === index ? { ...entry, customFid } : entry));
    onChange(next);
  };

  const searching = useSettingsSearching();

  return (
    <Collapsible open={open || searching} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        data-testid="settings-thumbnail-chain-trigger"
      >
        <RowLabel
          label={t('settings.appearance.thumbnail_chain.title')}
          desc={t('settings.appearance.thumbnail_chain.desc')}
        />
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0 ml-2',
            open && 'rotate-180'
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="px-4 pb-3 space-y-1" data-testid="settings-thumbnail-chain">
          {safeChain.map((entry, index) => (
            <li
              key={entry.type}
              className="flex items-center gap-1.5 rounded border border-border/40 bg-background/40 px-1.5 py-1"
              data-testid={`settings-thumbnail-chain-row-${entry.type}`}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                title={t('settings.appearance.thumbnail_chain.move_up')}
                aria-label={t('settings.appearance.thumbnail_chain.move_up')}
                data-testid={`settings-thumbnail-chain-${entry.type}-up`}
              >
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                disabled={index === safeChain.length - 1}
                onClick={() => move(index, 1)}
                title={t('settings.appearance.thumbnail_chain.move_down')}
                aria-label={t('settings.appearance.thumbnail_chain.move_down')}
                data-testid={`settings-thumbnail-chain-${entry.type}-down`}
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
              <Checkbox
                checked={entry.enabled}
                onCheckedChange={(checked) => toggle(index, checked === true)}
                data-testid={`settings-thumbnail-chain-${entry.type}-toggle`}
                aria-label={getLabel(entry.type)}
              />
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="text-xs font-medium truncate">{getLabel(entry.type)}</span>
                {entry.type === 'custom' && (
                  <Input
                    value={entry.customFid ?? ''}
                    onChange={(e) => setCustomFid(index, e.target.value)}
                    placeholder={t('settings.appearance.thumbnail_chain.custom_placeholder')}
                    className="h-6 w-28 font-mono text-xs"
                    data-testid="settings-thumbnail-chain-custom-fid"
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
