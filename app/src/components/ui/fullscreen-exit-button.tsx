import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from './button';

interface FullscreenExitButtonProps {
  /** The subject in fullscreen. Names the button in its tooltip, since a
   *  fullscreen page has nowhere else left to show it. */
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
  );
}
