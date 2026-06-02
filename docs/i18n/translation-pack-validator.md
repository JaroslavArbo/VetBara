# VetBara Translation Pack Validator

This validator checks reviewed translation packs before approved rows are imported into `src/i18n.js`.

It is intentionally strict. A translation pack can be useful for review even when many rows are still `needs_review`, but only rows marked `approved` are treated as import candidates.

## Command

Run:

node scripts/validate-i18n-pack.mjs docs/i18n/de-translation-pack.json
node scripts/validate-i18n-pack.mjs docs/i18n/it-translation-pack.json

## Accepted statuses

Each row must use one of these statuses:

- `needs_review`
- `approved`
- `rejected`
- `needs_discussion`

Only `approved` rows are importable.

## What is checked

For approved rows, the validator checks:

- `target` is not empty
- placeholders are preserved exactly
- protected terms remain unchanged
- protected terms mentioned in `notes` remain present in the target

## Placeholder rules

Placeholders must be preserved exactly, including braces and spelling.

Examples:

- `{role}`
- `{label}`
- `{event}`
- `{variants}`
- `{questions}`
- `{message}`
- `{variant}`

Correct example:

Open `{role}` QR  
QR für `{role}` öffnen

Incorrect example:

Open `{role}` QR  
QR für Rolle öffnen

## Protected terms

The validator protects technical and workflow terms such as:

- `correctAnswer`
- `variantCode`
- `questionId`
- `optionA`, `optionB`, `optionC`, `optionD`
- `VARIANT_CODE`
- `PASS`
- `NOT PASSED`
- `Candidate`
- `Examiner`
- `Centre`
- `Admin`
- `Practicing`
- `Consulting`
- `primary`
- `secondary`
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

These terms may be discussed during translation review, but they must not be silently changed in importable rows.

## Non-goals

The validator does not import translations.

It does not enable German or Italian in the UI.

It does not check linguistic quality. Human review is still required.
