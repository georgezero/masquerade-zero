# Worktree Start: Ingestion API + MCP + Codex Journal

This worktree is for implementing the plan in:
- `docs/future-api-mcp-codex-plan.md`

Branch:
- `feature/ingest-api-mcp-codex`

Base:
- synced from `master` at creation time

## Primary Goal
Build a shared ingestion pipeline that can be reused by:
1. External API ingestion
2. MCP tools
3. Freeform journal -> Codex extraction

## Phase 1 Scope (Start Here)
Implement internal ingestion core only (no MCP yet):
- Add ingestion domain types/interfaces
- Add strict validation schemas
- Add mapping from structured payloads to existing create functions
- Add dry-run parse/validate path
- Add basic unit tests for each entry type

### Suggested file layout
- `src/ingest/types.ts`
- `src/ingest/schemas.ts`
- `src/ingest/normalize.ts`
- `src/ingest/service.ts`
- `src/ingest/errors.ts`
- `src/ingest/__tests__/...`

## Phase 2 Scope
Add server-to-server API endpoint:
- `POST /api/ingest`
- Modes: `structured` and `freeform` (freeform may initially return "not implemented" if needed)
- API key auth middleware
- `dryRun` support
- idempotency key hook points

## Constraints
- Reuse existing app create functions for persistence.
- Do not bypass validation when writing entries.
- Keep model calls server-side only.
- Keep `master` stable; commit in small increments.

## Quick sanity checks
- `npm run build`
- relevant tests for ingestion module
- manual endpoint check with `curl` for structured mode

## Handoff note
If running a fresh Codex session in this worktree, begin by reading:
1. `WORKTREE_START.md`
2. `docs/future-api-mcp-codex-plan.md`
3. current entry creation flow in `src/index.ts` + `src/lib/app.ts`
