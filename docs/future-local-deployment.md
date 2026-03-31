# Future Local Deployment

## Migration Plan: Neon/Postgres + Neon Auth -> SQLite + SimpleAuth

This is a phased plan to migrate the app to a local-first stack:
- Database: SQLite (instead of Neon Postgres)
- Auth: SimpleAuth (instead of Neon Auth)

Goal: reduce hosted dependencies while preserving current product behavior.

## Scope Summary

Current coupling points:
- DB driver and schema are Postgres-specific (`drizzle-orm/neon-http`, `pg-core`, enums/uuid/timestamptz assumptions).
- Auth/session is Neon Auth-specific (`/api/auth/*` proxy routes, Neon cookies, `get-session` fetch).

Migration touches:
- `src/db/index.ts`
- `src/db/schema.ts`
- `drizzle.config.ts`
- `src/lib/auth.ts`
- auth routes in `src/index.ts`
- env parsing in `src/env.ts`
- docs and deployment config

## Phase 0: Preconditions

- Freeze schema-changing feature work during migration.
- Define target runtime:
  - single-node local server
  - SQLite file location and backup strategy
- Confirm SimpleAuth requirements:
  - email/password only for v1
  - password reset optional for v1

Deliverable:
- final migration acceptance checklist.

## Phase 1: DB Foundation (SQLite)

1. Add SQLite driver + Drizzle adapter.
2. Replace Neon db client in `src/db/index.ts`.
3. Convert schema from `pg-core` to `sqlite-core`:
   - Postgres enums -> text + app-level validation
   - UUID defaults -> generated IDs in app layer
   - timestamp behavior normalized to ISO strings
4. Update `drizzle.config.ts` to SQLite dialect.
5. Rebuild migrations and apply to local DB.

Validation:
- `npm run check`
- CRUD flows pass for all entry kinds.

Risks:
- subtle schema behavior drift (defaults, constraints, timestamps).

## Phase 2: Auth Foundation (SimpleAuth)

1. Introduce SimpleAuth config and env vars.
2. Replace Neon auth helper logic in `src/lib/auth.ts`.
3. Replace auth proxy/callback routes in `src/index.ts`:
   - sign-up
   - sign-in
   - sign-out
   - session lookup middleware
4. Preserve current viewer model contract (`Viewer`, profile-required behavior).

Validation:
- sign-up/sign-in/sign-out work end-to-end.
- protected pages and API routes enforce auth correctly.

Risks:
- session cookie semantics and callback flow differences.

## Phase 3: Data Migration (Optional but Recommended)

If existing Neon data must be preserved:

1. Export Postgres data (profiles, entries, journal artifacts, ingest tables).
2. Transform to SQLite-compatible shape.
3. Import into SQLite with integrity checks.
4. Run reconciliation checks:
   - row counts per table
   - spot-check user timelines
   - journal candidate/status correctness

Deliverable:
- repeatable migration script and rollback plan.

## Phase 4: Hardening + Cutover

1. Remove Neon-specific env vars and dead code.
2. Update docs and `.env.example`.
3. Add local backup/restore script for SQLite file.
4. Run regression checklist:
   - profile flows
   - all entry CRUD
   - journal parse + sentiment parse
   - benchmark pages
   - ingest API auth/rate/idempotency
5. Cutover to SQLite + SimpleAuth in target local environment.

## Timeline Estimate

- MVP local migration (no production data migration): 1-2 days.
- Production-ready migration (including data migration + hardening): 3-6 days.

## Recommended Execution Strategy

Use two PR tracks to reduce risk:

1. PR A: DB migration to SQLite while keeping auth stable.
2. PR B: Auth migration to SimpleAuth.

Then:
- PR C: cleanup, docs, and optional data migration scripts.

## Open Questions

- Do we require migrating all historical data, or only fresh start local mode?
- Is multi-user support needed in local deployment, or single-user only?
- Should API key ingest remain enabled in local mode?
- Do we need encrypted-at-rest SQLite for local deployment?

## TODO

- [ ] Confirm SimpleAuth package + session strategy
- [ ] Decide SQLite file path + backup schedule
- [ ] Create migration scripts (`pg -> sqlite`)
- [ ] Add local deployment runbook
- [ ] Add rollback procedure
