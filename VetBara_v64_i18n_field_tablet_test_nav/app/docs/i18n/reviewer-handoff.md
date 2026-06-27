# Translation reviewer handoff

## Scope

The translation review packs are documentation/data export files only. German, Italian, Swedish, Croatian, Dutch, Norwegian, French, Spanish, and Romanian are not live UI languages yet, and reviewing these files does not enable any runtime language.

## Files to review

Review one language at a time. Use one CSV per language as the normal reviewer handoff file:

- de German: `docs/i18n/de-translation-pack.csv`
- it Italian: `docs/i18n/it-translation-pack.csv`
- sv Swedish: `docs/i18n/sv-translation-pack.csv`
- hr Croatian: `docs/i18n/hr-translation-pack.csv`
- nl Dutch: `docs/i18n/nl-translation-pack.csv`
- no Norwegian: `docs/i18n/no-translation-pack.csv`
- fr French: `docs/i18n/fr-translation-pack.csv`
- es Spanish: `docs/i18n/es-translation-pack.csv`
- ro Romanian: `docs/i18n/ro-translation-pack.csv`

JSON files with the same language prefix contain the same rows and may be used by maintainers for technical inspection.

## What reviewers may edit

Reviewers should edit only:

- `target`
- `status`
- an optional reviewer comment column, if maintainers add one for a review round

Do not change:

- `key`
- `en`
- `cs`
- `notes`

The current CSV header is `key,en,cs,target,notes,status`. Keep field names, commas, quotes, UTF-8 encoding, and row order unchanged.

Targets are now prefilled draft suggestions. They still require human review before any row can move beyond `needs_review`.

## Status values

Use only these statuses:

- `needs_review`: empty, draft, or still awaiting review.
- `approved`: ready for later import into a runtime dictionary.
- `rejected`: must not be imported.
- `needs_discussion`: blocked on product, terminology, or technical clarification.

Only rows marked `approved` can later be imported into runtime dictionaries. Rows marked `needs_review`, `rejected`, or `needs_discussion` must remain out of runtime dictionaries.

## Placeholder rules

Every approved `target` must preserve the exact placeholder set from `en`. Placeholders may move to fit grammar, but they must not be renamed, removed, duplicated, or translated.

Known placeholders include:

- `{role}`
- `{label}`
- `{event}`
- `{variants}`
- `{questions}`
- `{message}`
- `{variant}`

Good:

- EN: `Dedicated {role} portal`
- Target: `Portal dedicado para {role}`

Bad:

- Target: `Portal dedicado para rol`
- Problem: `{role}` was removed.

## Protected terms

Protected terms must remain unchanged unless a product owner explicitly approves a localized term for that exact context.

Roles, values, and workflow terms:

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
- `Centre Setup`
- `Candidate QR`
- `Examiner QR`
- `Centre QR`
- `Draft Export`
- `Centre Audit Package`
- `sync queue`
- `pilot/archive placeholder`

Scoring and CSV/import field names:

- `PASS`
- `NOT PASSED`
- `correctAnswer`
- `variantCode`
- `questionId`
- `optionA`
- `optionB`
- `optionC`
- `optionD`
- `VARIANT_CODE`

CSV/import field names must remain unchanged. `correctAnswer` must stay limited to the existing CSV/JSON helper/import context and must not be introduced elsewhere.

Good:

- EN: `CSV columns: variantCode, questionId, correctAnswer.`
- Target: `Columnas CSV: variantCode, questionId, correctAnswer.`

Bad:

- Target: `Columnas CSV: codigoVariante, idPregunta, respuestaCorrecta.`
- Problem: CSV/import field names were translated.

Bad:

- Target: `Abrir QR del candidato`
- Problem: `Candidate QR` was translated without explicit approval.

## Returning reviewed files

Return the reviewed CSV for the language being reviewed. If a reviewer used a spreadsheet editor, export back to CSV with the same header and UTF-8 encoding. Do not send merged multi-language CSV files; keep one CSV per language.

Maintainers should compare returned files against the original pack, confirm only allowed columns changed, and then validate the reviewed JSON pack before any later import work.

## Maintainer validation

Run the validator for each reviewed JSON pack:

```sh
node scripts/validate-i18n-pack.mjs docs/i18n/de-translation-pack.json
node scripts/validate-i18n-pack.mjs docs/i18n/it-translation-pack.json
node scripts/validate-i18n-pack.mjs docs/i18n/sv-translation-pack.json
node scripts/validate-i18n-pack.mjs docs/i18n/hr-translation-pack.json
node scripts/validate-i18n-pack.mjs docs/i18n/nl-translation-pack.json
node scripts/validate-i18n-pack.mjs docs/i18n/no-translation-pack.json
node scripts/validate-i18n-pack.mjs docs/i18n/fr-translation-pack.json
node scripts/validate-i18n-pack.mjs docs/i18n/es-translation-pack.json
node scripts/validate-i18n-pack.mjs docs/i18n/ro-translation-pack.json
```

The validator checks only importable rows marked `approved`. Human review is still required for linguistic quality.
