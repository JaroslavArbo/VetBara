# VetBara OpenAI Translation Provider

This document describes the optional OpenAI provider for the i18n translation prefill tool.

The provider is used only by local tooling. It does not enable any runtime UI languages and does not modify `src/i18n.js`.

## Environment

Set a local API key before using the provider:

OPENAI_API_KEY=your_key_here

Optionally set the model:

OPENAI_TRANSLATION_MODEL=gpt-4.1-mini

Do not commit real API keys.

## Dry run

Always start with a dry run:

node scripts/prefill-i18n-pack-with-engine.mjs docs/i18n/de-translation-pack.json --provider openai --dry-run --limit 5

Dry run prints sample changes but does not write to the pack.

## Safe write test

Use a temporary copy first:

mkdir -p /tmp/i18n-openai-test
cp docs/i18n/de-translation-pack.json /tmp/i18n-openai-test/de-translation-pack.json
node scripts/prefill-i18n-pack-with-engine.mjs /tmp/i18n-openai-test/de-translation-pack.json --provider openai --write --limit 3
node scripts/validate-i18n-pack.mjs /tmp/i18n-openai-test/de-translation-pack.json

## Mask safety

The prefill script masks protected placeholders and terms before calling the provider.

The OpenAI provider is instructed to preserve every `__VETBARA_*__` token exactly.

It must also preserve placeholders such as:

- `{role}`
- `{label}`
- `{event}`
- `{variants}`
- `{questions}`
- `{message}`
- `{variant}`

## Review status

The provider must not mark rows as approved.

All rows remain `needs_review`.

Human review is still required before generated dictionaries can contain importable rows.

## Recommended workflow

1. Run mock provider validation.
2. Run OpenAI dry run with `--limit 5`.
3. Run OpenAI write mode only on a `/tmp` copy.
4. Validate the `/tmp` copy.
5. If approved by a maintainer, run on a real JSON pack.
6. Sync JSON to CSV.
7. Send CSV to reviewer.
8. Import only rows later marked `approved`.

## Non-goals

This provider does not change runtime app code.

It does not enable German, Italian, Swedish, Croatian, Dutch, Norwegian, French, Spanish, Romanian, or any other UI language.

It does not change backend, schema, QR payloads, scoring, PASS/FAIL logic, or import/export formats.
