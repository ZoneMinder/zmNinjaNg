/**
 * The language list both pickers render.
 *
 * Codes come from the bundled locale map rather than a hand-written array, so
 * registering a locale in locales/resources.ts is all it takes to offer it in
 * the sidebar switcher and in Settings. English leads because it is the
 * fallback locale every reader can retreat to; the rest sort by the name each
 * language uses for itself, which is the label on screen.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { LANGUAGE_CODES } from '../locales/resources';

export type LanguageOption = { code: string; label: string };

export function useLanguageOptions(): LanguageOption[] {
  const { t } = useTranslation();

  return useMemo(() => {
    const options = LANGUAGE_CODES.map((code) => ({ code, label: t(`languages.${code}`) }));
    return options.sort((a, b) => {
      if (a.code === b.code) return 0;
      if (a.code === 'en') return -1;
      if (b.code === 'en') return 1;
      return a.label.localeCompare(b.label);
    });
  }, [t]);
}
