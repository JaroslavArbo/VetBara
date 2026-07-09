# VetBara QR Base URL Design Note

## Purpose

This note describes future support for configurable QR base URLs for VetBara production and local LAN pilot modes.

The goal is to let Centre staff safely generate normal production QR links and, later, optional local LAN QR links without changing the QR/session model or breaking the current pilot flow.

## Current behavior

Production pilot QR links should point to the deployed VetBara app URL. This keeps Candidate and Examiner access aligned with the current Vercel deployment and Supabase/backend-backed pilot behavior.

The Centre QR access pack displays Candidate QR and Examiner QR links for the current Centre setup. That behavior should remain the default and safest path.

Any future QR base URL option should preserve current production QR behavior unless Centre staff explicitly choose a different mode.

## Problem to solve

Local LAN testing may need QR links that point to a local IP address or hostname, such as a MacBook or local server on the same venue network.

This creates several risks:

- local IP addresses can change between routers, hotspots, and venue networks
- a wrong base URL can make QR links unusable on tablets
- a URL that works on the admin machine may not work from Candidate or Examiner tablets
- production QR behavior must not be broken by local testing support

The feature needs to make local QR generation possible while keeping production QR links predictable and safe.

## Proposed future approach

A future implementation should:

- keep the production base URL as the default
- add an optional Centre/admin setting for a local QR base URL
- show a clear mode label, such as `Production QR` or `Local LAN QR`
- validate the local base URL format before generating links
- preview generated QR links before distribution
- never silently switch existing production QR links to a local base URL

The QR access pack should make the selected mode visible near the generated links. Centre staff should be able to return to production QR links without losing the current Centre setup.

## Safety rules

- local QR mode must be explicit
- UI must warn that local QR links only work on the same LAN
- Centre staff must confirm before distributing local QR links
- fallback to production QR should remain available
- no Candidate or Examiner should see other identities

Local QR mode should be treated as a temporary pilot/testing aid, not as a replacement for production QR distribution.

## Possible implementation areas

Future implementation may touch:

- Centre setup UI
- QR access pack component
- backend centre setup/session endpoint if the local base URL is persisted
- environment variable fallback if needed
- `docs/local-lan-pilot-guide.md`

The exact implementation should depend on whether the local base URL is temporary for one browser session or stored with Centre setup data.

## Open questions

- should local base URL be persisted or session-only?
- should it be allowed in production deployment?
- should QR links use IP address or local hostname?
- how should HTTPS/browser warnings be handled on tablets?
- how should local mode interact with future offline backend?

## Non-goals for now

- no implementation in this milestone
- no QR payload change
- no offline backend
- no local database
- no production behavior change
