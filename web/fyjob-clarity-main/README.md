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
VITE_API_BASE_URL=https://<your-function-app>.azurewebsites.net
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

## Route Behavior

- `/auth` for sign in.
- `/dashboard/*` protected by session.
- Unknown routes redirect to `/auth`.

## Related Modules

- Browser extension: `extension/`
- Azure backend functions: `azure-backend/`
