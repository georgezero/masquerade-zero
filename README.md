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
| `INGEST_API_KEY` | No* | - | Required only for `POST /api/ingest`; accepted via `Authorization: Bearer` or `x-api-key` |
| `INGEST_RATE_LIMIT_WINDOW_MS` | No | `60000` | Fixed-window rate-limit window in milliseconds |
| `INGEST_RATE_LIMIT_MAX` | No | `60` | Max ingest requests per window per API key + userId |
| `INGEST_IDEMPOTENCY_TTL_MS` | No | `3600000` | In-memory idempotency cache TTL (milliseconds) |
| `APP_URL` | No | `http://localhost:3001` | Public URL of the application |
| `PORT` | No | `3001` | Server port |

All variables are optional. The app degrades gracefully:
- **No DATABASE_URL**: DB operations return null/empty, demo mode works
- **No NEON_AUTH_***: Auth endpoints return 503, guests see demo mode
- **No INGEST_API_KEY**: `/api/ingest` returns 503

Example API key format:

```bash
INGEST_API_KEY=tz6_ingest_dev_kzJ9Vw2QmN7xR4pT8dL1sA5f
```

Generate a stronger key:

```bash
openssl rand -hex 32
```

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
- `409`: idempotency conflict or request already in flight
- `413`: request body too large
- `429`: rate limit exceeded (`Retry-After` header set)
- `501`: freeform mode not yet implemented
- `503`: ingest API not configured (`INGEST_API_KEY` missing)

Idempotency notes:
- Provide `idempotencyKey` to enable replay safety.
- Current implementation is **in-memory** (single-process best effort), controlled by `INGEST_IDEMPOTENCY_TTL_MS`.
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
