# VetBara Pilot Release Notes

## Pilot scope

This pilot build covers the current digital examination workflow prototype:

- Centre Setup save/load
- Candidate and Examiner QR workspaces
- test package import and sample package support
- Candidate written test persistence
- Consulting report draft persistence
- Examiner outdoor score/note persistence
- Evaluation Preview
- Draft Export
- Centre Audit Package
- pilot guidance panels and docs

## What to smoke-test after deploy

Use the smoke-test script for the full run-through. For release readiness, confirm these key paths:

- Centre Setup load/save
- QR access pack and copy links
- Candidate written test
- Consulting report draft
- Examiner outdoor form
- Evaluation Preview
- Draft Export
- Centre Audit Package
- Sync/Audit panel

## Known limitations

These limitations should be communicated before a pilot run:

- no official VETcert final certificate/result
- no final PASS/FAIL decision workflow
- no official VETcert export template
- no real image upload/storage
- no production-grade user management
- no full offline conflict resolution UI
- no completed multilingual production review

## Release readiness checklist

- [ ] build passes
- [ ] docs reviewed
- [ ] smoke test completed
- [ ] known limitations communicated
- [ ] production deployment verified
