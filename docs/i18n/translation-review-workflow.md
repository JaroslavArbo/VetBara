# Translation review workflow

## Purpose

This workflow explains how reviewers should complete the German, Italian, Swedish, Croatian, Dutch, Norwegian, French, and Spanish translation packs prepared from `src/i18n.js`.

The packs are review assets only. German, Italian, Swedish, Croatian, Dutch, Norwegian, French, and Spanish are not live UI languages yet, and this workflow must not be used to enable them in the language switcher.

Review-pack languages are de German, it Italian, sv Swedish, hr Croatian, nl Dutch, no Norwegian, fr French, and es Spanish.

## Files under review

Reviewers may work from either format:

- `docs/i18n/de-translation-pack.csv`
- `docs/i18n/de-translation-pack.json`
- `docs/i18n/it-translation-pack.csv`
- `docs/i18n/it-translation-pack.json`
- `docs/i18n/sv-translation-pack.csv`
- `docs/i18n/sv-translation-pack.json`
- `docs/i18n/hr-translation-pack.csv`
- `docs/i18n/hr-translation-pack.json`
- `docs/i18n/nl-translation-pack.csv`
- `docs/i18n/nl-translation-pack.json`
- `docs/i18n/no-translation-pack.csv`
- `docs/i18n/no-translation-pack.json`
- `docs/i18n/fr-translation-pack.csv`
- `docs/i18n/fr-translation-pack.json`
- `docs/i18n/es-translation-pack.csv`
- `docs/i18n/es-translation-pack.json`

The CSV and JSON packs represent the same rows. Choose one source of truth for each review round to avoid conflicting edits.

For the short external reviewer handoff, send `docs/i18n/reviewer-handoff.md` with the language CSV.

Each row contains:

- `key`: stable i18n key; do not edit.
- `en`: English source text; do not edit.
- `cs`: Czech source/reference text; do not edit.
- `target`: reviewer translation for the pack language.
- `notes`: protection, placeholder, or terminology guidance; do not edit.
- `status`: review state.

## Required status values

Use only these status values:

- `needs_review`: target is empty, draft, or awaiting first review.
- `approved`: target is ready for later import into `src/i18n.js`.
- `rejected`: target must not be imported.
- `needs_discussion`: reviewer cannot approve without product, terminology, or technical clarification.

Do not invent additional statuses. If a row is partially acceptable but still needs a decision, use `needs_discussion`.

## Editing CSV packs

When editing CSV:

- Keep UTF-8 encoding.
- Keep the header exactly: `key,en,cs,target,notes,status`.
- Edit only `target`, `status`, and an optional reviewer comment column if maintainers add one for a review round.
- Do not reorder rows unless the import owner explicitly asks for sorting changes.
- Do not edit source keys, source-language values, or `notes`.

Use a spreadsheet editor only if it preserves UTF-8, quotes, commas, and braces exactly. After editing, export back to CSV without changing the delimiter or header.

## Editing JSON packs

When editing JSON:

- Keep valid JSON.
- Keep each object field name unchanged.
- Edit only `target`, `status`, and an optional reviewer comment field if maintainers add one for a review round.
- Do not reorder keys inside objects unless the import owner agrees.
- Do not edit source keys, source-language values, or `notes`.

JSON is useful for technical review because placeholders and escaped characters are easier to inspect precisely.

## Protected terms

Protected terms must remain unchanged unless a product owner explicitly approves a localized term for that exact context.

Roles and portals:

- `Candidate`
- `Examiner`
- `Centre`
- `Admin`

Level, examiner, and role values:

- `Practicing`
- `Consulting`
- `primary`
- `secondary`

Data mode and workflow values:

- `backend-loaded pilot data`
- `demo fallback data`
- `Centre Setup`
- `Candidate QR`
- `Examiner QR`
- `Centre QR`
- `Draft Export`
- `Centre Audit Package`
- `sync queue`
- `pilot/archive placeholder`

Scoring and result values:

- `PASS`
- `NOT PASSED`

CSV/import field names:

- `correctAnswer`
- `variantCode`
- `questionId`
- `optionA`
- `optionB`
- `optionC`
- `optionD`
- `VARIANT_CODE`

CSV/import field names remain unchanged in every target value. The `correctAnswer` term must remain limited to the existing CSV/JSON helper/import context and must not be introduced anywhere else.

## Placeholder rules

Target text must preserve placeholders exactly. Keep the same placeholder set as the English source value, including braces and spelling.

Known placeholders in the current packs include:

- `{role}`
- `{label}`
- `{event}`
- `{variants}`
- `{questions}`
- `{message}`
- `{variant}`

The translated sentence may move a placeholder to a grammatically correct position, but it must not rename, remove, duplicate, or translate the placeholder.

## Data values remain unchanged

Do not translate protected data values in target text. This includes role names, level values, data mode values, result values, and field names listed above.

Examples that must remain unchanged inside otherwise translated text:

- `Candidate`
- `Examiner`
- `Centre`
- `Admin`
- `Practicing`
- `Consulting`
- `primary`
- `secondary`
- `backend-loaded pilot data`
- `demo fallback data`

## Examples

Acceptable German examples:

- EN: `Dedicated {role} portal`
- DE target: `Dediziertes {role}-Portal`
- Why: `{role}` is preserved exactly.

- EN: `Imported {variants} variant(s), {questions} question(s).`
- DE target: `{variants} Variante(n) und {questions} Frage(n) importiert.`
- Why: both placeholders are preserved exactly.

- EN: `CSV columns: variantCode, questionId, correctAnswer.`
- DE target: `CSV-Spalten: variantCode, questionId, correctAnswer.`
- Why: CSV/import field names remain unchanged.

Acceptable Italian examples:

- EN: `Scan {role} QR`
- IT target: `Scansiona il QR {role}`
- Why: `{role}` is preserved exactly.

- EN: `Copied {label} QR link`
- IT target: `Link QR {label} copiato`
- Why: `{label}` is preserved exactly.

Unacceptable examples:

- `Dediziertes {rolle}-Portal`
- Reason: `{role}` was renamed.

- `Imported {variants} variants.`
- Reason: `{questions}` was removed from a source that contains it.

- `CSV-Spalten: Variantencode, Fragen-ID, richtigeAntwort.`
- Reason: `variantCode`, `questionId`, and `correctAnswer` were translated.

- `Kandidat QR öffnen`
- Reason: protected data value `Candidate QR` was translated without explicit approval.

## Later import handoff

When review is complete:

1. Filter rows where `status` is `approved`.
2. Confirm every approved row has a non-empty `target`.
3. Confirm every approved target preserves the same placeholder set as the English source.
4. Confirm protected data values and CSV/import field names remain unchanged.
5. Import approved targets into the matching future dictionary in `src/i18n.js`: `translations.de`, `translations.it`, `translations.sv`, `translations.hr`, `translations.nl`, `translations.no`, `translations.fr`, or `translations.es`.
6. Keep the imported key set aligned with `translations.en`.
7. Run build and UI smoke tests after import.
8. Enable any reviewed language in the UI only in a later milestone after import validation and product approval.

German, Italian, Swedish, Croatian, Dutch, Norwegian, French, and Spanish are not enabled in the UI by this workflow.
