/**
 * Ninjii's place in a page toolbar (refs #246).
 *
 * The assistant answers from the command palette and a keyboard shortcut, and
 * from its own floating button once minimized - none of which announce
 * themselves on a tablet, where there is no keyboard and the palette is a
 * glyph. This puts it where a hand already is, beside the view menu.
 *
 * Two gates, both required: the assistant has to be configured in this scope
 * (useAssistantEnabled resolves that across a group's members, not from an
 * aggregate's own bucket, refs #337), and the profile has to have asked for it
 * in the toolbar. Off by default - a toolbar shared with per-page controls is
 * the one place a global tool has to earn its spot.
 */

import { useTranslation } from 'react-i18next';
import { useAssistantEnabled } from '../../hooks/useAssistantEnabled';
import { useAssistantPanelStore } from '../../stores/assistantPanel';
import { useProfileById } from '../../hooks/useCurrentProfile';
import { NINJII_LOGO_URL } from '../../lib/assistant/ninjii-logo';
import { Button } from '../ui/button';

export function NinjiiToolbarButton() {
  const { t } = useTranslation();
  // The toolbar flag is server-scoped, like every assistant key: read it from
  // the profile that carries the assistant configuration (refs #536).
  const { enabled, profileId } = useAssistantEnabled();
  const { settings } = useProfileById(profileId);
  const open = useAssistantPanelStore((s) => s.open);

  if (!enabled || !settings.assistantInToolbar) return null;

  return (
    <Button
      variant="outline"
      size="icon"
      className="h-8 w-8 sm:h-9 sm:w-9"
      onClick={open}
      title={t('assistant.ask_ninjii')}
      aria-label={t('assistant.ask_ninjii')}
      data-testid="ninjii-toolbar-button"
    >
      {/*
        Fills the control rather than taking a fixed size: `size="icon"` sets
        only a box and no padding, and the base class's `size-4` rule matches
        svg, not img, so a pinned 20px logo sat small in a 32px button and
        smaller still in the 36px one. Padding rather than a size keeps it
        right at both. Decorative: the button's own label names Ninjii.
      */}
      <img
        src={NINJII_LOGO_URL}
        alt=""
        className="h-full w-full rounded-full object-contain p-1"
      />
    </Button>
  );
}
