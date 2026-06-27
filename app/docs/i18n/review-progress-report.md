# Translation Review Progress Report

## Purpose

`scripts/report-i18n-review-progress.mjs` summarizes review progress for one or more i18n translation review packs. It is a reporting tool only. It does not import translations, approve rows, update runtime dictionaries, or enable any runtime UI languages.

Use it to see how many rows are still waiting for review, how many have been approved, and how many approved rows are ready for the approved dictionary generator.

## Command Examples

Run the report for all current review packs:

```sh
node scripts/report-i18n-review-progress.mjs \
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

Run the report for one language:

```sh
node scripts/report-i18n-review-progress.mjs docs/i18n/de-translation-pack.json
```

The script infers the language code from the filename, for example `de-translation-pack.json` becomes `de`.

## Generated Markdown Report

The script writes a generated Markdown report to:

```text
docs/i18n/generated/translation-review-progress.md
```

The report includes a timestamp, a per-language table, totals across all included languages, and reminders about import readiness.

## Status Meanings

- `needs_review`: target text is still awaiting human review.
- `approved`: target text is approved for later import if it is nonblank.
- `rejected`: target text must not be imported.
- `needs_discussion`: reviewer needs product, terminology, or technical clarification before approval.

The report does not fail just because rows are `needs_review`. It fails only when JSON cannot be parsed, entries cannot be found, or a row uses an unsupported status.

## import-ready Definition

`import-ready` means a row has `status` set to `approved` and a nonblank `target` value.

Rows marked `needs_review`, `rejected`, or `needs_discussion` are not import-ready. Rows marked `approved` with a blank target are counted as approved but not import-ready.

## Relationship With Other Tools

Use this report before the validator when you want a review progress overview.

Use `scripts/validate-i18n-pack.mjs` to validate approved rows before import. The validator checks import safety for approved rows, including placeholder and protected-term preservation.

Use `scripts/generate-approved-i18n-dictionary.mjs` only after rows are approved. Generated dictionaries remain empty unless approved rows exist.

## Runtime Impact

This report does not enable German, Italian, Swedish, Croatian, Dutch, Norwegian, French, Spanish, Romanian, or any other runtime UI language. Language enablement requires a separate implementation milestone after approved translations are imported and validated.
