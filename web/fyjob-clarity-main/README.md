# FYJOB Frontend (Vite + React + TypeScript)

Frontend dashboard for FYJOB, built with Vite, React, Tailwind, and shadcn/ui.

## Key UX Notes

- Multi-device ready: optimized for mobile, tablet, and desktop layouts.
- Settings, Alerts, and Encryption pages use responsive spacing and flexible card stacks.
- Design language aligned with the browser extension:
	- compact terminal-like labels
	- soft bordered cards
	- muted chips and status accents

## Local Development

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment

Create `.env.local` (or copy from `.env.local.example`) and set:

```bash
VITE_API_BASE_URL=https://fyjob.my.id
VITE_SUPABASE_URL=<your-supabase-url>
VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

### 3) Run dev server

```bash
npm run dev
```

### 4) Build for production

```bash
npm run build
```

## Deploy to Vercel

### Option A: Vercel Dashboard (recommended)

1. Import this folder (`web/fyjob-clarity-main`) as a Vercel project.
2. Framework preset: `Vite`.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Add environment variables from local `.env.local`.
6. Deploy.

### Option B: CLI

```bash
npm i -g vercel
vercel
vercel --prod
```

## Production Domain

- Web app: `https://fyjob.my.id`
- Extension API target: `https://fyjob.my.id/api`
- Dashboard login target for extension: `https://fyjob.my.id/auth`

## Deploy Extension to Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the `extension/` folder from this repository.
5. If you update extension files later, click the `Reload` button on the FYJOB extension card.
6. Open the FYJOB web dashboard at `https://fyjob.my.id`, log in, then open the extension side panel.

## Chrome Web Store Listing Guide

Use this flow to publish FYJOB extension to Chrome Web Store:

1. Prepare production extension package.
2. Ensure `manifest.json` has:
	- stable `name`, `version`, `description`
	- correct `permissions` and `host_permissions`
	- `icons` for 16, 32, 48, 128
3. Zip extension contents (files/folders inside `extension/`, not the parent folder).
4. Open Chrome Web Store Developer Dashboard: `https://chrome.google.com/webstore/devconsole`.
5. Pay one-time developer registration fee (if first publish).
6. Create new item and upload ZIP.
7. Fill listing assets:
	- short + detailed description
	- screenshots (desktop flow)
	- promo tile/icon
	- privacy policy URL and support email
8. Complete privacy and data usage form honestly:
	- explain auth/session usage
	- mention API calls to FYJOB backend
9. Submit for review and monitor status in dashboard.

Recommended release checklist:
- Test login sync web <-> extension on `https://fyjob.my.id`
- Test logout propagation both directions
- Validate all API calls point to `https://fyjob.my.id/api`
- Bump extension `version` before each upload

## Admin Center (Web Dashboard)

- Route: `/dashboard/admin`
- Visible only for users with `role=admin`
- Features:
  - Ban / unban user
  - View total users and banned users
  - Add token/credits to user
  - View remaining user credits
  - See most used and least used feature summary

Notes:
- Custom target email input in Alerts page is admin-only.
- Non-admin users can still send test email to their own account.

## Route Behavior

- `/auth` for sign in.
- `/dashboard/*` protected by session.
- Unknown routes redirect to `/auth`.

## Related Modules

- Browser extension: `extension/`
- Azure backend functions: `azure-backend/`
