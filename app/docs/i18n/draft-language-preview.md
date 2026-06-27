# Draft Language Preview

## Purpose

VetBara can expose draft UI translations for reviewer and stakeholder preview before those translations are approved for official exam use.

The draft preview languages are:

- de Deutsch
- it Italiano
- sv Svenska
- hr Hrvatski
- nl Nederlands
- no Norsk
- fr Français
- es Español
- ro Română

Czech remains the default runtime language, and English remains available as the stable fallback language.

## Preview-Only Status

Draft preview languages are UI preview only. They are not approved for official VETcert exam use, and selecting one does not change backend data, QR payloads, scoring logic, PASS/FAIL logic, candidate result logic, or import/export formats.

The app shows this warning when a draft UI language is selected:

```text
Draft machine translation preview — not approved for official VETcert exam use.
```

The Czech warning text is:

```text
Náhled strojového překladu — není schváleno pro oficiální zkoušku VETcert.
```

## Generated Dictionaries

The runtime draft dictionaries are generated from the existing JSON translation review packs. The generator reads each draft pack, extracts the `target` value for every key, and writes:

- `docs/i18n/generated/draft-runtime-dictionaries.json`
- `src/generated/draft-i18n-dictionaries.js`

The generated source module is imported by `src/i18n.js` so Vite can bundle the dictionaries reliably.

The generator fails before writing if a pack cannot be parsed, a key is duplicated, a target is blank, or placeholders in `en` and `target` do not match.

## Refresh Workflow

After translation pack edits, refresh the generated dictionaries with:

```sh
node scripts/generate-draft-i18n-runtime-dictionaries.mjs \
  docs/i18n/de-translation-pack.json \
  docs/i18n/it-translation-pack.json \
  docs/i18n/sv-translation-pack.json \
  docs/i18n/hr-translation-pack.json \
  docs/i18n/nl-translation-pack.json \
  docs/i18n/no-translation-pack.json \
  docs/i18n/fr-translation-pack.json \
  docs/i18n/es-translation-pack.json \
  docs/i18n/ro-translation-pack.json
```

Then run:

```sh
npm run build
```

## Validation

Validate the review packs before refreshing runtime draft dictionaries:

```sh
for lang in de it sv hr nl no fr es ro; do
  node scripts/validate-i18n-pack.mjs docs/i18n/${lang}-translation-pack.json
done
```

The validator checks approved import candidates. Draft preview rows should remain `needs_review` until a separate approval milestone changes their review status.

## Disabling Draft Preview

To remove or disable draft preview languages:

1. Remove the draft language entries from `LANGUAGES` in `src/i18n.js`.
2. Remove the generated draft dictionary import and merge from `src/i18n.js`.
3. Optionally delete `src/generated/draft-i18n-dictionaries.js` and `docs/i18n/generated/draft-runtime-dictionaries.json`.
4. Run `npm run build`.

Do not delete or rewrite translation review packs unless the review workflow explicitly requires it.

## Approval Boundary

Runtime language approval remains a separate milestone. This preview layer does not mark translation pack rows approved, does not make draft rows import-ready, and does not make draft translations official VETcert exam language content.
