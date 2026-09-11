---
name: add-language
description: Use when adding a new interface language (locale) to the app, or when asked to translate the UI into another language. Covers the translation file, the i18n resources, the plural forms the language needs, and the user doc that names the available languages.
---

# Adding a new interface language

The app bundles translations at build time. Adding a locale means touching three
code locations plus two prose locations. Miss any one and the failure is silent:
i18next falls back to English mid-screen, or the new locale ships with no
key-parity coverage.

Run all npm commands from `app/`.

Below, `{code}` is the ISO code (`it`) and `{Name}` is the language's own name
for itself (`Italiano`).

## 1. Create the translation file

```bash
mkdir -p app/src/locales/{code}
cp app/src/locales/en/translation.json app/src/locales/{code}/translation.json
```

## 2. Translate the values

Translate every value in `app/src/locales/{code}/translation.json`. Do not
change, add, or drop keys. The key-parity test in step 5 fails if the shape
drifts from `en`.

Labels must fit 320px (project rule in `AGENTS.project.md`), so prefer the
concise translation where two options exist.

## 3. Add the language name to every translation file

The `languages` section of each locale lists all languages, so the picker reads
correctly whatever language the UI is currently in. Add `"{code}": "{Name}"` to
the `languages` section of every `translation.json` under `app/src/locales/`,
the new one included. List them first rather than working from memory:

```bash
ls app/src/locales
```

Use the same string `{Name}` in all of them. Language names are not translated.

## 4. Register the locale

In `app/src/locales/resources.ts`, add the import alongside the others and the
entry in `LANGUAGE_RESOURCES`:

```typescript
import {code}Translation from './{code}/translation.json';
```

```typescript
export const LANGUAGE_RESOURCES = {
  // ...
  {code}: { translation: {code}Translation },
};
```

Both pickers and i18next read this map, so nothing else registers a locale.

## 5. Nothing to do for the pickers

Both of them, Settings → Appearance and the sidebar globe dropdown, render
`useLanguageOptions` (`app/src/hooks/useLanguageOptions.ts`), which reads the
codes registered in step 4 and orders them English first, then by label. The
order is covered by `app/src/components/layout/__tests__/LanguageSwitcher.test.tsx`,
which pins the expected sequence, so add the new code there.

## 6. Update the user doc

`docs/user-guide/settings.md`, Appearance table, Language row, names the
available languages in English. Add the new one.

## 7. Add the plural forms the language needs

English declares `_one` and `_other`. A language with more plural categories
needs the rest, or i18next finds no key for those counts and silently renders
English: Russian showed "2 monitors" until `_few` and `_many` were added. The
parity test checks every category `Intl.PluralRules` reports for counts up to
100, so it tells you which keys are missing.

```bash
node -e "console.log(new Intl.PluralRules('{code}').resolvedOptions().pluralCategories)"
```

## Nothing to do for dates, the assistant, or the parity test

These already take the active locale as data, so none of them needs a
per-locale entry:

- `app/src/lib/relative-time.ts` passes the code straight to
  `Intl.RelativeTimeFormat`.
- `app/src/lib/assistant/system-prompt.ts` interpolates the locale into the
  prompt and asks the model to answer in the user's language.
- `app/src/locales/__tests__/translation-keys.test.ts` discovers locale
  directories on disk, so the new one is key-checked against `en` with no edit.

## Verify

```bash
npm test
npx tsc -b
npm run build
npm run test:e2e -- settings.feature
```

`settings.feature` has a language-change scenario, so it is the relevant e2e
run for this change.

Then check the UI by hand: Settings → Appearance → Language, and the sidebar
globe dropdown. Both should list the new language, and selecting it should
change the visible text.

## Checklist

- [ ] `app/src/locales/{code}/translation.json` created and fully translated
- [ ] `languages.{code}` added to every translation file under `app/src/locales/`
- [ ] `app/src/i18n.ts` import and `resources` entry
- [ ] expected order updated in `LanguageSwitcher.test.tsx`
- [ ] plural forms for every category the language needs
- [ ] `docs/user-guide/settings.md` Language row
- [ ] `npm test`, `npx tsc -b`, `npm run build`, `npm run test:e2e -- settings.feature`
