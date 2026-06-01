# VetBara Pilot Release Checklist

Use this checklist when preparing and publishing a VetBara pilot release.

## Before release

- [ ] PRs merged into main
- [ ] GitHub Actions Build check is green
- [ ] local `npm run build` passes, if available
- [ ] docs reviewed
- [ ] known limitations reviewed
- [ ] pilot tester briefing reviewed

## Deploy

- [ ] pull latest main
- [ ] run `npm run build`
- [ ] deploy to Vercel production
- [ ] record deployed URL
- [ ] confirm app loads

## Smoke test

Use [docs/pilot-smoke-test.md](pilot-smoke-test.md) for the full smoke-test script.

- [ ] Centre Setup load/save
- [ ] QR access pack and copy links
- [ ] Candidate written test
- [ ] Consulting report draft
- [ ] Examiner outdoor form
- [ ] Evaluation Preview
- [ ] Draft Export
- [ ] Centre Audit Package
- [ ] Sync/Audit panel

## Release tag

Use a pilot version tag after the release is ready. The tag name can be changed for the actual pilot version.

```sh
git checkout main
git pull
git tag pilot-v0.1
git push origin pilot-v0.1
```

## Communication

- [ ] share deployed URL
- [ ] share pilot tester briefing
- [ ] share known limitations
- [ ] explain that the pilot does not issue official VETcert certification decisions

## Rollback note

If a critical issue appears, revert to the previous deployed Vercel version or previous Git tag, then document what failed.
