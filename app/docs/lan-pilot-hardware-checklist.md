# VetBara LAN Pilot Hardware Checklist

## Purpose

This checklist helps prepare the physical network kit for a VetBara pilot session with tablets connected over local Wi-Fi or LAN.

Use it before the pilot day to pack, label, power, and test the network setup. It assumes the recommended production-backend pilot mode where tablets use a local network but VetBara still reaches Vercel and Supabase/backend over the internet.

## Recommended baseline kit

- 1 primary travel router
- 1 backup travel router
- stable internet uplink
- optional unmanaged gigabit switch
- ethernet cables
- USB-C power adapters
- USB-C power bank
- power strip / extension cable
- labels or tape for SSID/password/router notes

## Recommended router models

Suggested travel router options:

- GL.iNet Beryl AX GL-MT3000 as the recommended baseline
- GL.iNet Slate AX GL-AXT1800 as a stronger alternative
- GL.iNet Slate 7 GL-BE3600 as a newer/advanced alternative

Exact availability may vary by country. Any chosen router should support stable Wi-Fi, NAT/router mode, and ideally wired WAN so the pilot network can use venue ethernet or another internet uplink.

## Internet uplink options

- venue ethernet as the preferred option
- 4G/5G mobile router or modem
- phone hotspot as fallback
- MacBook hotspot as emergency fallback

Production VetBara pilot mode needs internet access for Vercel, Supabase, and configured backend services. Test the uplink before Candidate and Examiner tablets join the session.

## Optional wired kit

- TP-Link TL-SG108 or similar 8-port gigabit unmanaged switch
- Cat6 patch cables: 1 m, 3 m, 5-10 m
- ethernet adapter for MacBook if needed

Use wired ethernet for the admin/Centre device when the venue allows it. A simple unmanaged switch is enough for a small pilot desk.

## Power kit

- USB-C PD charger for router
- spare USB-C cable
- USB-C power bank, ideally 20,000 mAh or more
- power strip with enough sockets
- tablet chargers
- optional small UPS/power station for longer sessions

Power the router from mains when possible. Keep the power bank ready for short moves, unstable sockets, or emergency continuity.

## Suggested Wi-Fi settings

- SSID example: `VetBara-Pilot`
- use a strong but readable password
- prefer 5 GHz where stable
- keep 2.4 GHz enabled for compatibility
- disable guest/client isolation if local device communication is needed
- set the router admin password
- avoid changing network during exam

Write the SSID, Wi-Fi password, and router admin note on a label or sealed setup sheet for Centre staff.

## Physical setup checklist

- [ ] router powered and labeled
- [ ] internet uplink connected
- [ ] admin/Centre device connected
- [ ] tablets connected to pilot Wi-Fi
- [ ] app URL opens on each tablet
- [ ] Centre QR opens
- [ ] Candidate QR opens
- [ ] Examiner QR opens
- [ ] Save/Load Centre Setup tested
- [ ] Sync/Audit panel checked
- [ ] exports tested

## Backup checklist

- [ ] backup router configured with same SSID/password if appropriate
- [ ] backup internet method available
- [ ] spare cables available
- [ ] spare power bank/charger available
- [ ] printed or offline copy of router admin details
- [ ] fallback plan if venue internet fails

## What not to overbuild for first pilot

- no rack router needed
- no full UniFi/enterprise setup needed unless the venue already has it
- no local server needed for recommended production-backend mode
- no NAS needed
- no offline database needed for variant A

Keep the first pilot network boring and easy to recover. Stability matters more than advanced network features.

## Related documents

- [docs/local-lan-pilot-guide.md](local-lan-pilot-guide.md)
- [docs/qr-base-url-design-note.md](qr-base-url-design-note.md)
- [docs/pilot-smoke-test.md](pilot-smoke-test.md)
- [docs/pilot-release-checklist.md](pilot-release-checklist.md)
