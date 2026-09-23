import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from './button';

interface FullscreenExitButtonProps {
  /** The subject in fullscreen, shown as a label beside the button. A
   *  fullscreen page hides the header that normally names it, and a tooltip
   *  alone never appears on a touch device (refs #527). */
  title: string;
  onExit: () => void;
  /** Prefix for the button's test id, e.g. `monitor-detail`. */
  testIdPrefix: string;
}

/**
 * The one way out of an app-level (CSS) fullscreen page, floating over the
 * picture rather than sitting in a strip above it, so the feed keeps the whole
 * screen. Shared by Monitor Detail and event playback.
 *
 * Landscape corners: Android reports no side inset, and the rounded corner
 * then swallowed the button, so the offsets are never under 0.75rem.
 */
export function FullscreenExitButton({ title, onExit, testIdPrefix }: FullscreenExitButtonProps) {
  const { t } = useTranslation();
  const label = t('monitor_detail.exit_fullscreen');
  return (
    <>
      <span
        className="fixed z-50 top-[max(0.75rem,var(--sai-top,env(safe-area-inset-top)))] left-[max(0.75rem,var(--sai-left,env(safe-area-inset-left)))] max-w-[60vw] min-w-0 truncate rounded-full bg-black/40 px-3 py-1.5 text-sm text-white/80 backdrop-blur-sm"
        title={title}
        data-testid={`${testIdPrefix}-fullscreen-title`}
      >
        {title}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="fixed z-50 top-[max(0.75rem,var(--sai-top,env(safe-area-inset-top)))] right-[max(0.75rem,var(--sai-right,env(safe-area-inset-right)))] rounded-full bg-black/40 text-white/80 backdrop-blur-sm hover:bg-black/70 hover:text-white"
        onClick={onExit}
        title={`${title} - ${label}`}
        aria-label={label}
        data-testid={`${testIdPrefix}-exit-fullscreen`}
      >
        <X className="h-5 w-5" />
      </Button>
    </>
  );
}
