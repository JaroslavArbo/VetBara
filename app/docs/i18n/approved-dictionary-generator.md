# Approved dictionary generator

## Purpose

`scripts/generate-approved-i18n-dictionary.mjs` reads reviewed translation pack JSON files and writes approved-only dictionary JSON files for later runtime import.

The generated dictionaries are documentation/data export artifacts. They are not runtime dictionaries, and they do not enable German, Italian, Swedish, Croatian, Dutch, Norwegian, French, Spanish, Romanian, or any other language in the UI.

## Command examples

Generate one approved dictionary:

```sh
node scripts/generate-approved-i18n-dictionary.mjs docs/i18n/de-translation-pack.json
```

Generate all current review-pack dictionaries:

```sh
node scripts/generate-approved-i18n-dictionary.mjs docs/i18n/de-translation-pack.json docs/i18n/it-translation-pack.json docs/i18n/sv-translation-pack.json docs/i18n/hr-translation-pack.json docs/i18n/nl-translation-pack.json docs/i18n/no-translation-pack.json docs/i18n/fr-translation-pack.json docs/i18n/es-translation-pack.json docs/i18n/ro-translation-pack.json
```

## Generated files

The script infers the language code from each pack filename and writes:

- `docs/i18n/generated/de-approved-dictionary.json`
- `docs/i18n/generated/it-approved-dictionary.json`
- `docs/i18n/generated/sv-approved-dictionary.json`
- `docs/i18n/generated/hr-approved-dictionary.json`
- `docs/i18n/generated/nl-approved-dictionary.json`
- `docs/i18n/generated/no-approved-dictionary.json`
- `docs/i18n/generated/fr-approved-dictionary.json`
- `docs/i18n/generated/es-approved-dictionary.json`
- `docs/i18n/generated/ro-approved-dictionary.json`

Each output is a flat dictionary:

```json
{
  "key.name": "translated target"
}
```

Because the current review packs have no approved rows, the current generated files are empty objects:

```json
{}
```

## Approved-only export

Only rows with `status` set to `approved` and a non-empty `target` are exported. Rows marked `needs_review`, `rejected`, or `needs_discussion` are skipped.

This keeps draft, rejected, and unresolved translations out of generated dictionaries. It also means review packs can contain unfinished work without accidentally feeding runtime import.

## Safety checks

Before writing an output dictionary, the generator validates approved rows with the same safety rules used by `scripts/validate-i18n-pack.mjs`:

- approved rows must have a non-empty `target`
- placeholders must be preserved exactly
- protected terms must remain present in the target
- protected terms listed in `notes` must remain present in the target
- each row must use an accepted status
- pack JSON must parse successfully
- language code must be inferred from a supported `*-translation-pack.json` filename

Known placeholders include:

- `{role}`
- `{label}`
- `{event}`
- `{variants}`
- `{questions}`
- `{message}`
- `{variant}`

Protected CSV/helper/import terms include:

- `correctAnswer`
- `variantCode`
- `questionId`
- `optionA`
- `optionB`
- `optionC`
- `optionD`
- `VARIANT_CODE`

Protected workflow and data values include:

- `Candidate`
- `Examiner`
- `Centre`
- `Admin`
- `Practicing`
- `Consulting`
- `primary`
- `secondary`
- `PASS`
- `NOT PASSED`
- `Centre Setup`
- `Candidate QR`
- `Examiner QR`
- `Centre QR`
- `Draft Export`
- `Centre Audit Package`
- `sync queue`
- `pilot/archive placeholder`
- `backend-loaded pilot data`
- `demo fallback data`

`correctAnswer` must remain limited to existing CSV/helper/import contexts and must not be introduced elsewhere.

## Later runtime import

In a later milestone, maintainers can use these generated dictionaries as the approved input for future `translations.de`, `translations.it`, `translations.sv`, `translations.hr`, `translations.nl`, `translations.no`, `translations.fr`, `translations.es`, and `translations.ro` runtime dictionaries.

That later import must still preserve the full key set expected by `src/i18n.js`, run validation, and receive product approval before any language is exposed in the runtime language switcher.
