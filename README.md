# Tennis Zero (Six Alpha)

A full-stack TypeScript web application for tracking tennis training, matches, nutrition, cross-training, and weekly goals. Built with **Hono**, **HTMX**, **Drizzle ORM**, **Neon PostgreSQL**, and **Tailwind CSS**.

Combines the feature set of [Tennis Zero](https://github.com/georgezero/tennis-zero-hono) with the HTMX architecture and branding from [Six Alpha Memoires](https://github.com/georgezero/six-alpha-memoires).

---

## Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js (ESM) |
| **Language** | TypeScript (strict mode) |
| **Framework** | [Hono](https://hono.dev) |
| **Server** | @hono/node-server |
| **Database** | [Neon](https://neon.tech) PostgreSQL (serverless) |
| **ORM** | [Drizzle](https://orm.drizzle.team) |
| **Auth** | Neon Auth (proxy-based sessions) |
| **Frontend** | Server-rendered HTML + [HTMX](https://htmx.org) |
| **Styling** | [Tailwind CSS](https://tailwindcss.com) (CDN) + custom CSS |
| **Validation** | [Zod](https://zod.dev) (env) + manual normalization (forms) |
| **Deployment** | [Vercel](https://vercel.com) |

---

## Features

- **5 entry types** with full CRUD: Goals, Practices, Matches, Diets, Exercises
- **HTMX-powered interactions** for authenticated users (server renders HTML fragments)
- **Server-to-server JSON ingest API** at `POST /api/ingest` (API key protected)
- **Demo mode** with localStorage for logged-out guests (vanilla JS SPA, no server required)
- **Profile completion gate** requiring first name, last name, and sex before access
- **Detailed player profiles** with UTR/NTRP ratings, dominant hand, play style, preferred surfaces, and more
- **Filterable history feed** with chronological entries across all types
- **Six Alpha branding** with 6A golden mark, responsive header, and glassmorphism dark theme
- **Flash messages** via HTTP-only cookies for server-side feedback
- **Responsive design** optimized for mobile and desktop

---

## Project Structure

```
tennis-zero-six-alpha/
├── src/
│   ├── index.ts              # Hono routes, middleware, server entry point
│   ├── templates.ts          # All server-rendered HTML templates
│   ├── env.ts                # Zod-validated environment config
│   ├── db/
│   │   ├── index.ts          # Nullable DB singleton (graceful when no DB)
│   │   └── schema.ts         # Drizzle schema (all tables + enums)
│   └── lib/
│       ├── app.ts            # Business logic, CRUD, Viewer type, profile management
│       ├── auth.ts           # Neon Auth proxy, session management, cookie handling
│       └── html.ts           # escapeHtml, formatDate, formatDateTime utilities
├── public/
│   ├── app.js                # Demo mode (localStorage SPA) + HTMX event handlers
│   └── app.css               # Brand lockup CSS, flash styles, HTMX transitions
├── drizzle/                  # Generated migration SQL files
├── scripts/
│   └── migrate.mjs           # Custom migration runner
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── vercel.json
├── .env.example
└── .gitignore
```

---

## Architecture

### Authenticated Mode (HTMX)

Server renders full HTML pages. Interactive operations (create, update, delete entries) use HTMX attributes to POST/PATCH/DELETE to API endpoints that return HTML fragments swapped into the DOM.

```
Browser                          Server
  │                                │
  │  GET /                         │
  │ ──────────────────────────────>│  Viewer middleware loads session + profile
  │  Full HTML page                │  Templates render complete page
  │ <──────────────────────────────│
  │                                │
  │  POST /api/practices           │
  │  (hx-post, hx-target=#main)   │
  │ ──────────────────────────────>│  Create entry, return updated feed HTML
  │  HTML fragment                 │
  │ <──────────────────────────────│  HTMX swaps into #main-content
```

### Guest/Demo Mode (Vanilla JS)

Logged-out users see a demo experience on the home page. All data lives in `localStorage`. Client-side JavaScript handles routing, rendering, and CRUD. No server calls needed.

```
Browser (/ as guest)
  │
  │  Server renders page shell with data-route="demo"
  │  app.js detects demo mode
  │  Seeds localStorage with George Zero sample data
  │  Renders demo launcher + history feed
  │  Client-side SPA navigation for /demo/* URLs
```

### Viewer Middleware

Every request passes through viewer middleware that:

1. Checks for an active Neon Auth session
2. Loads or creates the user's profile (user_profiles + player_profiles)
3. Creates a `Viewer` object with `role`, `authUser`, `profile`, and `profileRequired` fields
4. Makes the Viewer available to all route handlers via Hono context

```typescript
type Viewer = {
  role: "guest" | "member";
  authUser: AuthUser | null;
  profile: AppProfile | null;
  profileRequired: boolean;
};
```

---

## Database Schema

### Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `user_profiles` | Account info | userId (PK), email, firstName, lastName, sex, tennisNickname, avatarUrl |
| `player_profiles` | Tennis-specific data | userId (PK), utrSingles, ustaNtrpSingles, dominantHand, backhandStyle, level, playStyle |
| `goals` | Weekly training goals | id (UUID), userId, weekStart, planText |
| `practices` | Training sessions | id (UUID), userId, date, withCoach, coachName, workedOn, notes |
| `matches` | Match results | id (UUID), userId, date, opponent, score, notes |
| `diets` | Nutrition logs | id (UUID), userId, date, summary |
| `exercises` | Cross-training | id (UUID), userId, date, exerciseType, durationMin, notes |

### Enums

- `sex`: male, female, other, prefer_not_to_say
- `exercise_type`: Strength, Cardio, Mobility, Recovery, Other

All entry tables are keyed by `userId` for multi-tenancy. UUID primary keys with `defaultRandom()`.

---

## Routes

### Page Routes (Full HTML)

| Method | Path | Description |
|---|---|---|
| GET | `/` | Home (authenticated feed or guest demo) |
| GET | `/profile` | Profile form |
| GET | `/view/:kind/:id` | Entry detail |
| GET | `/edit/:kind/:id` | Entry edit form |
| GET | `/new/:kind` | New entry form |
| GET | `/demo` | Demo mode (explicit) |
| GET | `/demo/view/:kind/:id` | Demo detail |
| GET | `/demo/edit/:kind/:id` | Demo edit form |
| GET | `/demo/new/:kind` | Demo new form |

### HTMX API Routes (HTML Fragments)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/history?kind=&limit=` | Updated `#feed` section |
| POST | `/api/{goals\|practices\|matches\|diets\|exercises}` | Updated launcher + feed |
| PATCH | `/api/{goals\|practices\|matches\|diets\|exercises}/:id` | Updated entry detail |
| DELETE | `/api/{goals\|practices\|matches\|diets\|exercises}/:id` | HX-Redirect to `/` |
| POST | `/api/profile` | Updated profile form (or HX-Redirect) |

### Ingestion API Route (JSON)

| Method | Path | Description |
|---|---|---|
| POST | `/api/ingest` | API-key-protected ingestion endpoint (`structured` + `freeform` placeholder) |

### Auth Routes

| Method | Path | Description |
|---|---|---|
| GET/POST/OPTIONS | `/api/auth/*` | Proxy to Neon Auth |
| POST | `/auth/sign-up` | Email/password registration |
| POST | `/auth/sign-in` | Email/password login |
| POST | `/auth/sign-out` | Sign out (clears cookies) |
| GET | `/auth/callback` | Post-auth redirect |

---

## Key Patterns

### Flash Messages

Server-side one-shot messages via HTTP-only cookies:

```typescript
// Set a flash
setCookie(c, "flash", message, { path: "/", httpOnly: true, sameSite: "Lax" });

// Read and clear
const flash = getCookie(c, "flash");
if (flash) deleteCookie(c, "flash", { path: "/" });
```

### HTMX Error Handling

Error handler detects HTMX requests and returns inline flash HTML instead of redirecting:

```typescript
app.onError((error, c) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  if (c.req.header("hx-request")) {
    return c.html(`<div class="flash">${message}</div>`, 500);
  }
  setFlash(c, message);
  return c.redirect("/");
});
```

### Template Functions

All HTML is generated by TypeScript template functions in `src/templates.ts`. Each function returns an HTML string:

```typescript
export function page(opts: PageOptions): string { ... }
export function historySection(items: HistoryItem[], total: number, filter: string): string { ... }
export function entryForm(kind: string, item?: HistoryItem): string { ... }
```

### CRUD Dispatch Tables

Route handlers use record-based dispatch for DRY multi-entity CRUD:

```typescript
const creators: Record<string, (userId: string, body: Record<string, unknown>) => Promise<void>> = {
  goal: createGoal,
  practice: createPractice,
  match: createMatch,
  diet: createDiet,
  exercise: createExercise,
};
```

### Profile Completion Gate

Users must complete firstName, lastName, and sex before accessing the app. The viewer middleware sets `profileRequired: true` and the home route renders the profile form instead of the feed.

### Asset Cache Busting

Static assets use a version query parameter that's bumped on each deploy:

```typescript
const ASSET_VERSION = "20260315-six-alpha-007";
// <script src="/app.js?v=${ASSET_VERSION}" defer></script>
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- A [Neon](https://neon.tech) PostgreSQL database (optional for demo-only mode)

### Setup

```bash
# Clone
git clone https://github.com/georgezero/tennis-zero-six-alpha.git
cd tennis-zero-six-alpha

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your Neon credentials (or leave empty for demo-only mode)

# Run migrations (if DATABASE_URL is configured)
npm run db:migrate

# Start development server
npm run dev
```

The app starts at `http://localhost:3001`. Without a database configured, demo mode still works using localStorage.

### Build & Production

```bash
npm run build      # Compile TypeScript to dist/
npm start          # Run compiled server
npm run check      # Type-check without emitting
npm run test       # Unit tests
npm run test:ingest-api  # Local integration checks for /api/ingest (401/200/409/429)
npm run test:ingest-api:db  # DB-backed idempotency checks (replay + expiry)
npm run test:ingest-api:scopes  # Scoped-key checks (200/403 coverage)
```

### Local Script Testing

Journal LLM local testing instructions for scripts live in:

```bash
scripts/LOCAL_TESTING.md
```

Quick start (no-auth local mode):

```bash
TEST_KEY='local-journal-test-key' APP_URL='http://localhost:3003' MODEL='openai/gpt-oss-20b' COMPARE_MODELS=true ./scripts/test-journal-llm-samples.sh
```

Smoke scripts:

```bash
INGEST_KEY="<api-key>" ./scripts/smoke-ingest-api.sh
APP_URL="https://tennis-zero-six-alpha-ingest.fff.ad" INGEST_KEY="<api-key>" ./scripts/smoke-ingest-api-cloudflare.sh
```

### Database Migrations

```bash
# Generate migration SQL from schema changes
npm run db:generate

# Apply pending migrations
npm run db:migrate

# Mark migrations as applied without running them
node scripts/migrate.mjs --mark-applied 0001_initial.sql
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | No | - | Neon PostgreSQL connection string |
| `NEON_AUTH_BASE_URL` | No | - | Neon Auth service URL |
| `NEON_AUTH_COOKIE_SECRET` | No | - | Cookie signing secret for auth |
| `INGEST_API_KEY` | No* | - | Single-key fallback for ingest auth (full ingest scopes) |
| `INGEST_API_KEYS_JSON` | No* | - | Preferred multi-key JSON config with per-key scopes and optional `allowedUserIds` |
| `INGEST_CLEANUP_INTERVAL_MS` | No | `60000` | Interval for ingest runtime cleanup of expired idempotency/rate-limit state |
| `INGEST_RATE_LIMIT_WINDOW_MS` | No | `60000` | Fixed-window rate-limit window in milliseconds |
| `INGEST_RATE_LIMIT_MAX` | No | `60` | Max ingest requests per window per API key + userId |
| `INGEST_IDEMPOTENCY_TTL_MS` | No | `3600000` | Idempotency TTL (used for DB + fallback memory runtime) |
| `APP_URL` | No | `http://localhost:3001` | Public URL of the application |
| `JOURNAL_LLM_ENABLED` | No | `false` | Enables LLM-backed journal candidate extraction in `/api/journal/preview` |
| `JOURNAL_LLM_PROVIDER` | No | `openai-compatible` | LLM provider type (currently OpenAI-compatible transport) |
| `JOURNAL_LLM_BASE_URL` | No | - | Base URL for OpenAI-compatible API (for example LM Studio gateway) |
| `JOURNAL_LLM_API_KEY` | No | - | API key sent to OpenAI-compatible provider |
| `JOURNAL_LLM_MODEL` | No | - | Primary model id used by default for journal extraction |
| `JOURNAL_LLM_SECONDARY_MODEL` | No | - | Secondary model id available in selector and compare mode |
| `JOURNAL_LLM_TEST_PREVIEW_KEY` | No | - | Enables `/api/journal/preview-test` JSON endpoint for no-auth local testing |
| `JOURNAL_LLM_TIMEOUT_MS` | No | `12000` | Timeout for LLM extraction request |
| `JOURNAL_LLM_MAX_INPUT_CHARS` | No | `12000` | Max journal text length before skipping LLM call |
| `PORT` | No | `3001` | Server port |

All variables are optional. The app degrades gracefully:
- **No DATABASE_URL**: DB operations return null/empty, demo mode works
- **No NEON_AUTH_***: Auth endpoints return 503, guests see demo mode
- **No INGEST_API_KEY and no INGEST_API_KEYS_JSON**: `/api/ingest` returns 503
- **Journal LLM vars missing/disabled**: journal preview uses deterministic parser fallback

Example API key format:

```bash
INGEST_API_KEY=tz6_ingest_dev_kzJ9Vw2QmN7xR4pT8dL1sA5f
```

Generate a stronger key:

```bash
openssl rand -hex 32
```

`INGEST_API_KEY` vs `INGEST_KEY`:
- `INGEST_API_KEY` is the server-side env var your app reads.
- `INGEST_KEY` is only a shell variable used by the smoke-test scripts as the client credential.

Preferred scoped key config example (`INGEST_API_KEYS_JSON`):

```json
[
  {
    "id": "local-dev",
    "key": "tz6_ingest_local_test_1234567890abcdef",
    "scopes": ["ingest:write", "ingest:dryrun"]
  },
  {
    "id": "preview-readonly",
    "key": "tz6_ingest_preview_abcdef0123456789",
    "scopes": ["ingest:dryrun"],
    "allowedUserIds": ["smoke-user", "preview-user"]
  }
]
```

Scope behavior:
- `ingest:write`: required for non-`dryRun` structured writes.
- `ingest:dryrun`: allows `dryRun` structured requests and freeform preview mode.
- Requests outside allowed scope or disallowed `userId` return `403`.

If you run the app via the user `systemd` service on this machine, edit:

```bash
/home/george/Downloads/src/ai/openai/tennis-zero-six-alpha-ingest/.runtime/service.env
```

Example:

```bash
PORT=3002
INGEST_API_KEY=tz6_ingest_local_test_1234567890abcdef
```

Then restart:

```bash
systemctl --user restart tennis-zero-six-alpha-ingest-app.service
```

### Journal LLM (OpenAI-Compatible / LM Studio)

Set these in `.env` to enable LLM extraction in journal preview:

```bash
JOURNAL_LLM_ENABLED=true
JOURNAL_LLM_PROVIDER=openai-compatible
JOURNAL_LLM_BASE_URL=https://mango.fff.ad/v1
JOURNAL_LLM_API_KEY=lmstudio
JOURNAL_LLM_MODEL=openai/gpt-oss-20b
JOURNAL_LLM_SECONDARY_MODEL=qwen/qwen3.5-9b
JOURNAL_LLM_TEST_PREVIEW_KEY=local-journal-test-key
JOURNAL_LLM_TIMEOUT_MS=12000
JOURNAL_LLM_MAX_INPUT_CHARS=12000
```

Behavior:
- Primary model: `JOURNAL_LLM_MODEL` (`openai/gpt-oss-20b` in the example above).
- Secondary model: `JOURNAL_LLM_SECONDARY_MODEL` (`qwen/qwen3.5-9b` in the example above).
- `/api/journal/preview` tries LLM extraction first.
- LLM output still passes the existing ingest validation dry-run.
- On timeout/invalid JSON/schema mismatch, the app falls back to deterministic parsing and tags candidates as fallback.
- `/journal` includes a model selector for reprocessing with either configured model.
- Optional "Compare models" runs both models and shows side-by-side latency/candidate/error stats, while using the selected model's candidate cards for confirm/dismiss.
- `/api/journal/preview-test` is available for local automation when `JOURNAL_LLM_TEST_PREVIEW_KEY` is set (header: `x-journal-test-key`).

Reference docs:
- Prompt used for prose extraction with `openai/gpt-oss-20b`: `docs/journal-llm-prompt-gpt-oss-20b.md`
- Prose sample capture summary (`openai/gpt-oss-20b`): `docs/journal-llm-prose-capture-summary-gpt-oss-20b.md`
- API/script testing guide: `docs/journal-llm-api-testing.md`

---

## Ingestion API

`POST /api/ingest` is intended for server-to-server clients (not browser HTMX flows).

Authentication:
- `Authorization: Bearer <INGEST_API_KEY>` or `x-api-key: <INGEST_API_KEY>`

Request modes:
- `structured`: implemented
- `freeform`: currently returns `501 Not Implemented`

### Structured Request Shape

```json
{
  "mode": "structured",
  "userId": "user_123",
  "dryRun": true,
  "idempotencyKey": "req-20260316-001",
  "items": [
    {
      "kind": "practice",
      "fields": {
        "date": "2026-03-16",
        "workedOn": "Serve + return",
        "withCoach": true,
        "coachName": "Coach Kim",
        "notes": "Short, high-intensity block"
      },
      "source": "api",
      "confidence": 1,
      "warnings": []
    }
  ]
}
```

### Structured Response Shape

```json
{
  "accepted": true,
  "candidates": [],
  "created": [],
  "errors": [],
  "warnings": []
}
```

Status behavior:
- `200`: parsed/validated (and persisted when `dryRun` is false)
- `400`: invalid JSON body or invalid request contract
- `401`: API key missing/invalid
- `403`: key is valid but missing scope or disallowed `userId`
- `409`: idempotency conflict or request already in flight
- `413`: request body too large
- `429`: rate limit exceeded (`Retry-After` header set)
- `501`: freeform mode not yet implemented
- `503`: ingest API not configured (`INGEST_API_KEY` / `INGEST_API_KEYS_JSON` missing)

Idempotency notes:
- Provide `idempotencyKey` to enable replay safety.
- With `DATABASE_URL` configured, idempotency + rate-limit state is stored durably in Postgres.
- If DB is unavailable, it falls back to in-memory behavior for dev.
- A repeated request with the same key + same payload returns cached response.
- Same key + different payload returns `409`.

### curl Examples

Dry run:

```bash
curl -sS -X POST http://localhost:3001/api/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer tz6_ingest_dev_kzJ9Vw2QmN7xR4pT8dL1sA5f" \
  -d '{
    "mode":"structured",
    "userId":"user_123",
    "dryRun":true,
    "items":[
      {"kind":"goal","fields":{"weekStart":"2026-03-16","planText":"Keep first-serve percentage above 60%"}}
    ]
  }'
```

Persist write:

```bash
curl -sS -X POST http://localhost:3001/api/ingest \
  -H "Content-Type: application/json" \
  -H "x-api-key: tz6_ingest_dev_kzJ9Vw2QmN7xR4pT8dL1sA5f" \
  -d '{
    "mode":"structured",
    "userId":"user_123",
    "idempotencyKey":"ing-20260316-0001",
    "items":[
      {"kind":"exercise","fields":{"date":"2026-03-16","durationMin":35,"exerciseType":"Mobility","notes":"Hip and shoulder mobility"}}
    ]
  }'
```

---

## Deployment

### Vercel

The project includes `vercel.json` with `{ "framework": "hono" }`. Deploy with:

```bash
vercel
```

Set environment variables in the Vercel dashboard.

### Cloudflare Tunnel

For local development exposed via tunnel:

```yaml
# ~/.cloudflared/config-tennis-zero.yml
tunnel: <tunnel-id>
credentials-file: ~/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: tennis-zero-six-alpha.fff.ad
    service: http://localhost:3001
  - service: http_status:404
```

```bash
cloudflared tunnel --config ~/.cloudflared/config-tennis-zero.yml run
```

---

## Design

### Theme

Dark slate background with glassmorphism cards, neon glow accents:
- **Primary**: Cyan (`#22d3ee`) for interactive elements
- **Accent**: Amber (`#fbbf24`) for warnings/demo mode
- **Background**: Slate 950 (`#020617`) with semi-transparent cards
- **Glass effect**: `bg-slate-950/35 backdrop-blur border-white/10`

### Entry Type Colors

| Type | Color | Glow |
|---|---|---|
| Goal | Cyan | `shadow-[0_0_12px_rgba(34,211,238,0.4)]` |
| Practice | Indigo | `shadow-[0_0_12px_rgba(99,102,241,0.4)]` |
| Match | Lime | `shadow-[0_0_12px_rgba(163,230,53,0.4)]` |
| Diet | Amber | `shadow-[0_0_12px_rgba(251,191,36,0.4)]` |
| Exercise | Fuchsia | `shadow-[0_0_12px_rgba(232,121,249,0.4)]` |

### Brand Lockup

6A golden square mark alongside "Six Alpha" label, with "Tennis Zero" as the application heading. Uses Space Grotesk for brand elements and Inter for body text.

---

## License

Private repository.
