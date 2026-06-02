# Translation review checklist

Use this checklist for each German, Italian, Swedish, Croatian, Dutch, Norwegian, or French review pass. These languages are not live UI languages yet.

## Pack setup

- [ ] Review one language pack at a time: German, Italian, Swedish, Croatian, Dutch, Norwegian, or French.
- [ ] Choose one editable format for the pass: CSV or JSON.
- [ ] Confirm the file keeps the expected fields: `key`, `en`, `cs`, `target`, `notes`, `status`.
- [ ] Confirm source fields `key`, `en`, and `cs` were not edited.
- [ ] Confirm every row uses one of these statuses: `needs_review`, `approved`, `rejected`, `needs_discussion`.

## Target review

- [ ] Fill or review only the `target` field for translated text.
- [ ] Keep `needs_review` for rows still awaiting review.
- [ ] Use `approved` only when the target is ready for later import.
- [ ] Use `rejected` when the target must not be imported.
- [ ] Use `needs_discussion` when terminology, product wording, or technical behavior needs clarification.

## Protected terms checklist

Roles and portals remain unchanged unless explicitly approved:

- [ ] `Candidate`
- [ ] `Examiner`
- [ ] `Centre`
- [ ] `Admin`

Level, examiner, and role values remain unchanged:

- [ ] `Practicing`
- [ ] `Consulting`
- [ ] `primary`
- [ ] `secondary`

Data mode and workflow values remain unchanged:

- [ ] `backend-loaded pilot data`
- [ ] `demo fallback data`
- [ ] `Centre Setup`
- [ ] `Candidate QR`
- [ ] `Examiner QR`
- [ ] `Centre QR`
- [ ] `Draft Export`
- [ ] `Centre Audit Package`
- [ ] `sync queue`
- [ ] `pilot/archive placeholder`

Scoring values remain unchanged:

- [ ] `PASS`
- [ ] `NOT PASSED`

CSV/import field names remain unchanged:

- [ ] `correctAnswer`
- [ ] `variantCode`
- [ ] `questionId`
- [ ] `optionA`
- [ ] `optionB`
- [ ] `optionC`
- [ ] `optionD`
- [ ] `VARIANT_CODE`

## Placeholder checklist

Target must preserve placeholders exactly. The translated sentence may reorder placeholders, but must not rename, remove, duplicate, or translate them.

- [ ] `{role}` remains `{role}`.
- [ ] `{label}` remains `{label}`.
- [ ] `{event}` remains `{event}`.
- [ ] `{variants}` remains `{variants}`.
- [ ] `{questions}` remains `{questions}`.
- [ ] `{message}` remains `{message}`.
- [ ] `{variant}` remains `{variant}`.
- [ ] Each approved target has the same placeholder set as its English source.

## Acceptable examples

- [ ] DE: `Dedicated {role} portal` -> `Dediziertes {role}-Portal`.
- [ ] DE: `Imported {variants} variant(s), {questions} question(s).` -> `{variants} Variante(n) und {questions} Frage(n) importiert.`
- [ ] IT: `Scan {role} QR` -> `Scansiona il QR {role}`.
- [ ] IT: `Copied {label} QR link` -> `Link QR {label} copiato`.
- [ ] Import helper: `CSV columns: variantCode, questionId, correctAnswer.` -> translated surrounding words only; field names stay unchanged.

## Unacceptable examples

- [ ] `{role}` changed to `{rolle}` or `{ruolo}`.
- [ ] `{questions}` removed from a target whose English source contains `{questions}`.
- [ ] `correctAnswer` translated or renamed.
- [ ] `variantCode`, `questionId`, `optionA`, `optionB`, `optionC`, or `optionD` translated or renamed.
- [ ] `Candidate QR`, `Examiner QR`, or `Centre QR` translated without explicit approval.
- [ ] `PASS` or `NOT PASSED` translated.

## Handoff for later import

- [ ] Export or save the reviewed CSV/JSON with UTF-8 encoding.
- [ ] Confirm all importable rows are marked `approved`.
- [ ] Confirm every `approved` row has a non-empty `target`.
- [ ] Confirm no row marked `rejected`, `needs_review`, or `needs_discussion` is imported.
- [ ] Confirm approved targets are ready for the matching future dictionary: `translations.de`, `translations.it`, `translations.sv`, `translations.hr`, `translations.nl`, `translations.no`, or `translations.fr`.
- [ ] Confirm German, Italian, Swedish, Croatian, Dutch, Norwegian, and French remain disabled in the UI until a later implementation milestone explicitly enables them.
