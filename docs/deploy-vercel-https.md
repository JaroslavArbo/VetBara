# VetBara — Production HTTPS deployment (Vercel + Supabase Cloud)

Deploying to Vercel gives every tablet a real `https://` origin. That secure
context is what unblocks **GPS (geolocation), camera and microphone (getUserMedia)**
— the exact APIs that are disabled on a plain-HTTP LAN address. No app store or
Apple Developer account is required for this; "Add to Home Screen" then makes it
feel installed (the app already ships a `manifest.webmanifest`).

## Prerequisites (only the human can do these)

- A **Supabase Cloud** project (creating an account/project needs a human).
- The Vercel project — already linked (`.vercel/project.json`, project `vetbara`).
- The **Supabase CLI** locally (`npx supabase …`) to push migrations.

## 1. Supabase Cloud project

1. Create a project at supabase.com. Note **Project URL**, **service_role key**
   (Project Settings → API), and the **database password**.
2. Push the schema (tables + `exam-media` storage bucket + grants):
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push          # applies everything in supabase/migrations/
   ```
   All five migrations are cloud-safe, including `20260726_exam_media.sql`
   (creates the private `exam-media` bucket) and `20260727_grant_service_role.sql`.
3. Seed the QR tokens after the app is deployed (step 4) via:
   ```bash
   curl -X POST https://<your-app>.vercel.app/api/seed \
     -H "x-seed-secret: <VETBARA_SEED_SECRET>"
   ```
   (Seeds Centre/Candidate/Examiner demo tokens. For per-exam Centre links the
   admin generates them in-app; they self-register via /api/admin/centre-links/register.)

## 2. Vercel environment variables (Project → Settings → Environment Variables)

Set for the **Production** (and Preview) environment:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the project's service_role key (secret) |
| `VETBARA_SESSION_SECRET` | a strong random string |
| `VETBARA_SEED_SECRET` | a strong random string |
| `VETBARA_DEMO_MODE` | `false` |

Do **not** set `SUPABASE_PUBLIC_URL` in production — `SUPABASE_URL` is already a
public HTTPS origin there. (That variable exists only for the local-LAN dev case.)

## 3. Deploy

`vercel.json` is already set (`framework: vite`, build `npm run build`, output
`dist`). Deploy by pushing to the connected git branch, or `vercel --prod`.
Multi-entry build ships both `index.html` (Centre/Candidate/Examiner) and
`admin.html` (standalone Admin).

## 4. Verify on a tablet (over Wi-Fi + internet)

- Open `https://<app>.vercel.app` — padlock present (secure context).
- **Admin** (`/admin.html` or the Admin role): first login **Bara / VetBara2026**,
  then change credentials.
- Generate a Centre link → open it on a second tablet → auto-unlocks.
- **Candidate/Examiner**: camera photo, mic voice recording, and the field-tablet
  **GPS map** now work (they were blocked on http LAN).
- Media (photos + recordings) upload to the Supabase `exam-media` bucket; Centre
  "Recordings & photos" panel shows them with download links.

## What is production-ready vs. not

**Ready as Vercel serverless functions (`api/*.js`)** — the core exam flow AND
Admin exam-package authoring/publishing:
health, seed, qr/resolve, session/bootstrap, sync/batch, centre/setup,
centre/audit-export, evaluation/*, media/* (upload-url, list),
admin/auth/* (login, change-password), admin/centre-links/register, and (ported
to Supabase in migration `20260729`):
- `admin/test-package/authoring/save`, `.../approve`, `.../list`, `.../latest`,
  `.../approved`, and `centre/test-package/active` — author → approve → the
  active package Centre/Candidate load. Writes require an Admin session; the
  active-package read is public (candidates need it).
- `admin/authoring-drafts/save|list|latest` — structured editor drafts.

**NOT yet production-backed** — still dev-only mocks in `vite.config.js` (persist
to local files); 404 in production until ported. Next wave:

- `/api/exams/*` — **field preparation + field-tablet sync** (priority next).
- `/api/admin/test-package/convert` — PDF→package conversion (needs pdf-parse +
  multipart in a function).
- `/api/admin/test-package/{id}` GET, `/api/admin/authoring-drafts/{id}` GET,
  `/api/admin/package-history/*` — fetch-one / history management (dynamic-id
  routes; use Vercel `[id].js`).
- `/api/admin/centre-links` (save/list) — Centre-link **history list** (the token
  itself already registers via `/register`).
- `/api/local-*`, `/api/translations/overrides`.

Also note: the READ endpoints (`test-package/list|latest|approved`,
`authoring-drafts/list|latest`) are currently **not gated** (they return exam
content without a session, matching the dev mock). Gate them behind a valid
session as a security follow-up.
