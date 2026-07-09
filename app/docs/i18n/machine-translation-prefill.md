# VetBara Machine Translation Prefill

This tooling prepares translation review packs with draft target suggestions.

It does not approve translations.

It does not enable new runtime UI languages.

It does not modify `src/i18n.js`.

## Current provider

The first supported provider is:

- `mock`

The mock provider does not call any external API. It returns deterministic draft text so the prefill pipeline can be tested safely.

## Commands

Dry run:

node scripts/prefill-i18n-pack-with-engine.mjs docs/i18n/de-translation-pack.json --provider mock --dry-run --limit 5

Write mode:

node scripts/prefill-i18n-pack-with-engine.mjs docs/i18n/de-translation-pack.json --provider mock --write --limit 5

Use write mode carefully. The recommended first test is on a temporary copy.

## Temporary write test

cp docs/i18n/de-translation-pack.json /tmp/de-translation-pack-test.json
node scripts/prefill-i18n-pack-with-engine.mjs /tmp/de-translation-pack-test.json --provider mock --write --limit 5
node scripts/validate-i18n-pack.mjs /tmp/de-translation-pack-test.json

## Status rule

All rows remain `needs_review`.

The prefill engine must never mark rows as `approved`.

Human review is still required before runtime import.

## Masking

The prefill script masks placeholders and protected terms before translation, then restores them.

Protected placeholders include:

- `{role}`
- `{label}`
- `{event}`
- `{variants}`
- `{questions}`
- `{message}`
- `{variant}`

Protected terms include:

- `correctAnswer`
- `variantCode`
- `questionId`
- `optionA`
- `optionB`
- `optionC`
- `optionD`
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
- `VETcert`
- `VetBara`

## Current limitation

This milestone updates JSON packs only.

CSV sync is intentionally left for a later milestone.

## Future providers

The provider interface is prepared for future DeepL or OpenAI adapters.

API keys must stay in local environment files and must never be committed.
