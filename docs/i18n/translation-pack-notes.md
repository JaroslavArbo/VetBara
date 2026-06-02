# Translation review packs

## Purpose

These files prepare reviewable translation packs from the current English i18n dictionary in `src/i18n.js`. They are documentation/data export only. German, Italian, Swedish, Croatian, Dutch, Norwegian, and French are not enabled in the runtime UI yet.

## Files

- `de-translation-pack.json` and `de-translation-pack.csv` contain the German review pack.
- `it-translation-pack.json` and `it-translation-pack.csv` contain the Italian review pack.
- `sv-translation-pack.json` and `sv-translation-pack.csv` contain the Swedish review pack.
- `hr-translation-pack.json` and `hr-translation-pack.csv` contain the Croatian review pack.
- `nl-translation-pack.json` and `nl-translation-pack.csv` contain the Dutch review pack.
- `no-translation-pack.json` and `no-translation-pack.csv` contain the Norwegian review pack.
- `fr-translation-pack.json` and `fr-translation-pack.csv` contain the French review pack.

Each row contains `key`, `en`, `cs`, `target`, `notes`, and `status`. The `target` column is intentionally blank for this milestone, and every row is marked `needs_review`. Reviewers should fill only the `target` value and leave the key and source values unchanged.

## Review process

1. Open either the JSON or CSV pack for the language being reviewed.
2. Translate only the `target` field.
3. Keep `status` as `needs_review` until the language owner has approved the row.
4. After approval, update `status` to the agreed reviewed-state value in the downstream import step.
5. Do not change source keys, English values, protected terms, or placeholder syntax.

## Protected terms

The following terms are protected and should remain exactly as written unless a product owner explicitly approves a localized term:

- Roles and portals: `Candidate`, `Examiner`, `Centre`, `Admin`.
- Level/type values and role values: `Practicing`, `Consulting`, `primary`, `secondary`.
- Data mode values: `backend-loaded pilot data`, `demo fallback data`.
- Workflow labels: `Centre Setup`, `Candidate QR`, `Examiner QR`, `Centre QR`, `Draft Export`, `Centre Audit Package`, `sync queue`, `pilot/archive placeholder`.
- Scoring values: `PASS`, `NOT PASSED`.
- Import/export field names: `correctAnswer`, `variantCode`, `questionId`, `optionA`, `optionB`, `optionC`, `optionD`, `VARIANT_CODE`.

`correctAnswer` appears only in the existing CSV/JSON import helper context. Do not expose or reuse it outside that context.

## Placeholder rules

Preserve placeholders exactly, including braces and spelling:

- `{role}`
- `{label}`
- `{event}`
- `{variants}`
- `{questions}`
- `{message}`
- `{variant}`

If a reviewed target contains a placeholder, it must contain the same placeholder set as the English source value.

## Later import into `src/i18n.js`

After translations are reviewed, import approved `target` values into the matching future dictionaries in `src/i18n.js`: `translations.de`, `translations.it`, `translations.sv`, `translations.hr`, `translations.nl`, `translations.no`, and `translations.fr`. The import should preserve the same key set as `translations.en`. Only after that import is complete and validated should the runtime language switcher be changed to expose any of these languages.

## Current runtime behavior

This milestone does not enable German, Italian, Swedish, Croatian, Dutch, Norwegian, or French in the UI, does not change backend code, does not change schema, does not change QR payloads, and does not change scoring or import/export behavior.
