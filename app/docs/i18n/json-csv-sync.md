# JSON to CSV Translation Pack Sync

## Purpose

`scripts/sync-i18n-json-targets-to-csv.mjs` keeps CSV translation review packs aligned with JSON translation review packs after JSON-based tooling updates draft `target` or `status` values.

The script is tooling only. It does not enable runtime UI languages, does not modify `src/i18n.js`, does not call external APIs, and does not approve rows by itself.

## What It Updates

For each matching row, the script updates only these CSV columns from the JSON pack:

- `target`
- `status`

It does not change these CSV columns:

- `key`
- `en`
- `cs`
- `notes`

CSV row order is preserved, and the CSV header must remain exactly:

```text
key,en,cs,target,notes,status
```

## Command Examples

Dry-run is the default mode:

```sh
node scripts/sync-i18n-json-targets-to-csv.mjs docs/i18n/de-translation-pack.json
```

Explicit dry-run:

```sh
node scripts/sync-i18n-json-targets-to-csv.mjs docs/i18n/de-translation-pack.json --dry-run
```

Write changes to the inferred CSV path:

```sh
node scripts/sync-i18n-json-targets-to-csv.mjs docs/i18n/de-translation-pack.json --write
```

Write to a temporary CSV for testing:

```sh
cp docs/i18n/de-translation-pack.json /tmp/de-translation-pack-test.json
cp docs/i18n/de-translation-pack.csv /tmp/de-translation-pack-test.csv
node scripts/sync-i18n-json-targets-to-csv.mjs /tmp/de-translation-pack-test.json --write --csv /tmp/de-translation-pack-test.csv
```

The `--csv` override is allowed only with a single JSON pack path.

## Safety Checks

The script fails before writing if:

- JSON cannot be parsed.
- The CSV file is missing.
- Required CSV columns are missing.
- The CSV header is not exactly `key,en,cs,target,notes,status`.
- Duplicate keys exist in JSON or CSV.
- JSON and CSV key sets differ.
- Any row has an unsupported `status` value.

Supported statuses are:

- `needs_review`
- `approved`
- `rejected`
- `needs_discussion`

## Protected Terms

This sync tool copies reviewer workflow values between existing pack formats. It does not translate protected terms, rewrite notes, or alter import/export examples such as `correctAnswer`, `variantCode`, `questionId`, `optionA`, `optionB`, `optionC`, `optionD`, or `VARIANT_CODE`.

Protected-term and placeholder safety should still be checked with:

```sh
node scripts/validate-i18n-pack.mjs docs/i18n/de-translation-pack.json
```

## Expected Workflow

1. Run JSON prefill or review tooling.
2. Run this sync script in `--dry-run` mode.
3. Review the summary counts for changed `target` and `status` values.
4. Run again with `--write` only when the CSV should be updated.
5. Run the translation pack validator after syncing.

The script does not mark rows `approved`. Reviewers must explicitly set `status` through the normal review workflow.
