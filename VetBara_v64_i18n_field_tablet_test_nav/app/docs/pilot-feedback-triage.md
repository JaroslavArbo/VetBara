# VetBara Pilot Feedback Triage Guide

## Purpose

This guide helps the team review GitHub Issues from VetBara pilot testers and decide what needs action before, during, or after the pilot. Use it to keep feedback consistent, privacy-aware, and focused on pilot readiness.

## Feedback categories

Use one primary category when possible:

- blocking bug
- non-blocking bug
- usability issue
- wording/microcopy issue
- follow-up feature
- documentation gap
- known limitation

## Severity levels

- Critical: blocks pilot testing or causes data loss/security/privacy risk
- High: breaks an important pilot workflow but has a workaround
- Medium: confusing or inconvenient but pilot can continue
- Low: polish, wording, or future improvement

## Triage checklist

- [ ] confirm role affected: Centre, Candidate, Examiner
- [ ] confirm device/browser
- [ ] confirm deployed URL/environment
- [ ] check whether the issue is reproducible
- [ ] check whether local work/data visibility is affected
- [ ] check whether QR/session flow is involved
- [ ] check whether sync queue/export/evaluation preview is involved
- [ ] check whether it is already listed as a known limitation
- [ ] ask for screenshot or screen recording if needed
- [ ] avoid unnecessary personal data in follow-up

## Pilot decision labels

Suggested labels:

- pilot
- bug
- feedback
- enhancement
- docs
- critical
- high
- medium
- low
- duplicate
- known-limitation

Labels may need to be created manually in GitHub if they do not already exist.

## When to fix immediately

Prioritize immediate fixes when:

- Candidate or Examiner cannot open assigned workspace
- Centre cannot Load/Save Centre Setup
- persisted test/report/outdoor data disappears unexpectedly
- Evaluation Preview or exports fail for all users
- QR/session leak or wrong-role visibility
- serious privacy or data exposure issue

## When to defer

Defer items that are known future work and do not block the pilot, such as:

- official PASS/FAIL workflow
- official certificate/result template
- real image upload/storage
- full multilingual production review
- production-grade user management
- full offline conflict resolution UI
- broad design polish not blocking the pilot

## Suggested issue response format

Use a short response so testers know what happens next:

```text
Thanks for reporting this.

What we understood:
Current category/severity:
Next action:
More information needed:
```

## Weekly pilot review

Review these items at least weekly during the pilot:

- new critical/high issues
- repeated usability complaints
- failed smoke-test steps
- export/evaluation issues
- documentation gaps
- decisions moved to future milestones

## Closing issues

- close when fixed and verified
- close duplicates with link to canonical issue
- close known limitations only when clearly documented
- keep future feature requests open or move to backlog if useful
