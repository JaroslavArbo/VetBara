# VetBara OpenAI Translation Smoke-Test Workflow

This document describes the safe smoke-test workflow for the optional OpenAI translation provider.

The OpenAI provider is local tooling only. It must not be used directly by the runtime application.

## Purpose

The smoke test verifies that the OpenAI translation provider can:

- translate a small number of i18n review-pack rows
- preserve protected mask tokens
- preserve placeholders
- keep all rows in `needs_review`
- produce a translation pack that still passes validation

The smoke test must be run on a temporary copy first.

## Non-goals

This workflow does not enable new runtime UI languages.

It does not modify `src/i18n.js`.

It does not approve translations.

It does not change backend, schema, QR payloads, scoring, PASS/FAIL logic, persistence, or import/export formats.

## Required environment

Set these values only in your local shell or local environment file:

OPENAI_API_KEY=your_key_here
OPENAI_TRANSLATION_MODEL=gpt-4.1-mini

Never commit real API keys.

## Step 1 — Confirm current tooling

Run from the repository root:

npm run build

node scripts/prefill-i18n-pack-with-engine.mjs docs/i18n/de-translation-pack.json --provider mock --dry-run --limit 5

The mock dry-run should complete without changing any files.

## Step 2 — Create a temporary test copy

Use a temporary directory so the real review pack is not modified:

mkdir -p /tmp/i18n-openai-test
cp docs/i18n/de-translation-pack.json /tmp/i18n-openai-test/de-translation-pack.json

The copied file must keep the exact filename format:

de-translation-pack.json

This is required because the prefill script infers the language from the filename.

## Step 3 — Run OpenAI on the temporary copy

Run a very small test first:

OPENAI_TRANSLATION_MODEL=gpt-4.1-mini \
node scripts/prefill-i18n-pack-with-engine.mjs /tmp/i18n-openai-test/de-translation-pack.json --provider openai --write --limit 3

Expected behavior:

- only the temporary copy is modified
- target values may be replaced in the first eligible rows
- status remains `needs_review`
- no row becomes `approved`

## Step 4 — Validate the temporary copy

Run:

node scripts/validate-i18n-pack.mjs /tmp/i18n-openai-test/de-translation-pack.json

Expected result:

- totalEntries: 376
- approved: 0
- errors: 0
- warnings: 0

## Step 5 — Inspect changed target values

Inspect the temporary file manually.

Check that:

- placeholders such as `{role}` are preserved exactly
- protected terms remain unchanged
- `correctAnswer` is not translated
- `variantCode`, `questionId`, `optionA`, `optionB`, `optionC`, `optionD`, and `VARIANT_CODE` remain unchanged
- `PASS` and `NOT PASSED` remain unchanged
- `Candidate`, `Examiner`, `Centre`, `Admin`, `Practicing`, and `Consulting` remain unchanged where protected
- the translation is linguistically acceptable as a draft

## Step 6 — Optional CSV sync test on temporary files

If the temporary JSON looks good, test JSON-to-CSV sync on temporary files only:

cp docs/i18n/de-translation-pack.csv /tmp/i18n-openai-test/de-translation-pack.csv

node scripts/sync-i18n-json-targets-to-csv.mjs /tmp/i18n-openai-test/de-translation-pack.json --write --csv /tmp/i18n-openai-test/de-translation-pack.csv

This should update only `target` and `status` in the temporary CSV.

## Step 7 — Do not approve automatically

The OpenAI provider must never mark rows as `approved`.

A human reviewer must review the CSV or JSON pack and explicitly change `status` to `approved` only for accepted rows.

## Step 8 — Real pack update rule

Only after a successful temporary smoke test and maintainer approval should the provider be run on a real pack.

Recommended real-pack workflow:

1. create a dedicated branch
2. run OpenAI with a small `--limit`
3. validate the JSON pack
4. sync JSON to CSV
5. validate again
6. commit only the intended language pack changes
7. keep every changed row as `needs_review`

## Example real-pack command

Use only after the temporary smoke test has passed:

OPENAI_TRANSLATION_MODEL=gpt-4.1-mini \
node scripts/prefill-i18n-pack-with-engine.mjs docs/i18n/de-translation-pack.json --provider openai --write --limit 25

Then run:

node scripts/validate-i18n-pack.mjs docs/i18n/de-translation-pack.json
node scripts/sync-i18n-json-targets-to-csv.mjs docs/i18n/de-translation-pack.json --write

## Final checks before PR

Run:

npm run build

for lang in de it sv hr nl no fr es ro; do
  node scripts/validate-i18n-pack.mjs docs/i18n/${lang}-translation-pack.json
done

git diff -- src/i18n.js

Expected:

- build passes
- all validators pass
- `src/i18n.js` is unchanged
- no runtime UI languages are enabled

