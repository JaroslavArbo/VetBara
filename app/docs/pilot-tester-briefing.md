# VetBara Pilot Tester Briefing

## What this pilot is

VetBara is being tested as a pilot prototype for the digital examination workflow. The goal is to validate the flow, usability, persistence, QR access, and export steps before a wider production-ready release.

This pilot is not yet the official VETcert certification system. Please use it to test how the workflow behaves and where testers need clearer guidance.

## What this pilot is not

This pilot is:

- not an official VETcert final result
- not a final PASS/FAIL system
- not an official certificate generator
- not a production user-management system
- not a final multilingual release
- not real photo/image storage yet

## Roles in the pilot

- **Centre:** prepares Centre Setup, candidates, examiners, assignments, QR access, imports test packages, and exports audit material.
- **Candidate:** opens the Candidate portal with their personal Candidate QR, confirms identity, completes assigned sections, and submits pilot work.
- **Examiner:** opens the Examiner portal with their personal Examiner QR, confirms identity, reviews assigned Candidates, and records outdoor form scores and notes.

## What testers should try

Please try the main pilot flow end to end where possible:

- Centre Setup load/save
- Candidate QR login
- Candidate identity confirmation
- written test answer
- Consulting report draft
- Examiner QR login
- outdoor score and note
- Evaluation Preview
- Draft Export
- Centre Audit Package

## What testers should report

Please report anything that could block or confuse a real pilot run, including:

- confusing wording
- missing guidance
- broken QR/session flow
- data not visible after reload
- sync queue errors
- incorrect role visibility
- export missing expected summary data
- UI layout problems on tablet/laptop

## What testers do not need to report as bugs

These are known pilot limitations and do not need to be reported as bugs unless they behave differently from the briefing:

- lack of official PASS/FAIL
- lack of official certificate
- placeholder photo/archive entries instead of real uploads
- demo fallback data when backend Centre Setup is not loaded
- visual polish issues that are already listed as pilot limitations
- missing full production translation review

## Handling sync/session issues

Visible local work should remain visible if a sync warning appears. If sync errors persist, reopen the personal QR/session and retry the action.

If something looks wrong before final submit, ask Centre staff before continuing.

## Data and privacy caution

Use pilot/test data unless instructed otherwise. Avoid unnecessary sensitive personal data during testing. Do not distribute QR links to the wrong person.

## Feedback format

When sending feedback, please include:

- role used
- device/browser
- what you tried
- what happened
- what you expected
- screenshot if possible
- whether the issue blocks the pilot or is only confusing

## Final reminder

This pilot is for validating workflow, not issuing official certification decisions.
