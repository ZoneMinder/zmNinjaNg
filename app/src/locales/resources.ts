/**
 * The bundled locales, in one place so nothing has to re-list them.
 *
 * i18n.ts feeds this to i18next, and useLanguageOptions reads the codes for
 * the two language pickers. Adding a language means adding it here and
 * nowhere else in the React code.
 */
import enTranslation from './en/translation.json';
import deTranslation from './de/translation.json';
import esTranslation from './es/translation.json';
import frTranslation from './fr/translation.json';
import itTranslation from './it/translation.json';
import ruTranslation from './ru/translation.json';
import zhTranslation from './zh/translation.json';

export const LANGUAGE_RESOURCES = {
  en: { translation: enTranslation },
  de: { translation: deTranslation },
  es: { translation: esTranslation },
  fr: { translation: frTranslation },
  it: { translation: itTranslation },
  ru: { translation: ruTranslation },
  zh: { translation: zhTranslation },
};

export const LANGUAGE_CODES = Object.keys(LANGUAGE_RESOURCES);
