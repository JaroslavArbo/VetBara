# VetBara Local LAN Pilot Guide

## Purpose

This guide explains practical ways to connect Candidate and Examiner tablets on a local network during VetBara pilot testing. It is intended for pilot organizers, Centre staff, and technical helpers who need a stable tablet setup at a venue.

The guide focuses on local Wi-Fi or cable networking options. It does not introduce a new offline backend mode.

## Recommended pilot mode: local network + production backend

For real pilot testing, the recommended setup is a local network for the tablets while VetBara continues to run from the deployed production app URL.

In this mode:

- Candidate, Examiner, and Centre devices connect to the same local Wi-Fi or venue router.
- Tablets open the deployed Vercel URL.
- VetBara still uses the internet to reach Vercel, Supabase, and any configured backend services.
- QR access, sessions, sync behavior, and exports continue to use the current deployed pilot behavior.
- Internet access is required throughout the pilot.

Diagram:

```text
Tablets -> local Wi-Fi/router -> internet -> Vercel + Supabase
```

This is the best current option for real pilot testing because it keeps the production-equivalent app, QR/session handling, persistence, sync, and export behavior in place while giving all tablets a stable local network.

## Network hardware options

Common hardware options are:

- travel router with internet uplink
- normal venue router
- phone hotspot
- MacBook hotspot
- wired ethernet for the server/admin machine, if available

A travel router is preferred for pilot stability because it gives the team a controlled network name, password, and device list. A venue router can also work well if the organizer can confirm that tablets are allowed to communicate normally and the internet connection is reliable.

All tablets should use the same network during the exam. Avoid captive portals and guest networks with client isolation if possible, because they can block devices from reaching local admin/server URLs or make troubleshooting harder.

Phone or MacBook hotspots can be useful for small demos, but they are usually less predictable than a dedicated router for a real pilot session.

## Local frontend/server mode

A MacBook can serve the app locally for demos, prototype checks, or quick tablet layout tests. In this mode, tablets open the app through the Mac's LAN IP address and dev server port.

Example:

```sh
cd ~/vetbara
npm run build
npm run dev -- --host 0.0.0.0
```

Find the Mac Wi-Fi IP address:

```sh
ipconfig getifaddr en0
```

Tablet URL example:

```text
http://192.168.1.23:5173
```

This is useful for demo and prototype checks, especially when validating tablet layout or local frontend behavior. It may not fully support backend API persistence unless Vercel/serverless API behavior and backend access are also available from that local setup.

## Local Vercel dev mode

`vercel dev` can emulate Vercel functions locally and may be useful for testing API routes from a MacBook.

Example:

```sh
vercel dev --listen 3000
```

Tablet URL example:

```text
http://192.168.1.23:3000
```

This can help with local API route testing, but exposing it to tablets on the LAN may require extra configuration for host binding, firewall permissions, and environment variables. It still needs backend/Supabase access unless a local database or backend is introduced.

## Fully offline LAN mode: future work

A fully offline LAN mode is not currently supported as a production-equivalent VetBara pilot mode.

Supporting it would require additional technical work, including:

- local backend/API services
- local database or Supabase replacement
- local QR base URL generation
- later sync and export strategy
- conflict handling if multiple devices edit offline

Until that exists, pilot organizers should treat fully offline operation as future work and use the recommended production-backend mode for real pilot testing.

## QR link considerations

Production pilot QR links should point to the deployed VetBara app URL. This keeps Candidate and Examiner links aligned with the current deployed QR/session behavior.

Local LAN QR links would need explicit local base URL support. If a local server is used, QR links must resolve from the tablets, not only from the MacBook. For example, a link using `localhost` on the Mac will not work from a tablet because `localhost` would refer to the tablet itself.

The local IP address may change when the MacBook changes Wi-Fi networks, reconnects, or moves between router/hotspot setups. Recheck the Mac IP address before generating or sharing any local test links.

## Troubleshooting checklist

- [ ] tablet and server/admin device are on the same Wi-Fi
- [ ] guest isolation is disabled
- [ ] Mac firewall allows incoming connections
- [ ] correct IP address and port are used
- [ ] app opens from tablet browser
- [ ] internet works if using production backend
- [ ] QR links point to a reachable URL
- [ ] Vercel/Supabase credentials are available if needed
- [ ] avoid switching networks during exam

## Security / privacy notes

- Do not share QR links with the wrong person.
- Use pilot/test data unless instructed otherwise.
- Prefer password-protected Wi-Fi.
- Avoid public open networks.
- Keep the admin/Centre device controlled by Centre staff or the pilot organizer.

## Recommended pilot setup checklist

- [ ] travel router or stable Wi-Fi ready
- [ ] internet tested
- [ ] deployed VetBara URL opens on tablets
- [ ] Centre QR/session tested
- [ ] Candidate QR tested
- [ ] Examiner QR tested
- [ ] Save/Load Centre Setup tested
- [ ] Sync/Audit panel checked
- [ ] exports tested
- [ ] fallback plan prepared

## Future technical milestones

Possible future work:

- configurable QR base URL
- local backend mode
- local database package
- LAN/offline sync server
- device discovery or local status page
- admin network diagnostics panel
