# Future Implementation Plan: API, MCP, and Codex Journal Ingestion

## Goal
Add reliable AI-assisted data ingestion without breaking existing flows.

The plan is to build one shared ingestion pipeline, then connect multiple inputs to it:
- External API requests
- MCP tools
- In-app freeform journal input (Codex/LLM extraction)

This keeps behavior consistent and avoids duplicated parsing logic.

## Current App Context
The app already has strong primitives to reuse:
- Existing entry types: `goal`, `practice`, `match`, `diet`, `exercise`
- Existing create/update/delete logic in backend services
- Existing HTML/HTMX routes and authenticated viewer model

Recommended direction: treat AI/API ingestion as another source of valid entry payloads, not a separate data model.

## Architecture Direction

### 1) Shared Ingestion Service (Core)
Create a backend ingestion module that:
- Accepts either structured input or freeform text
- Normalizes to strict internal payloads by entry type
- Validates fields with schema checks
- Returns parsed candidates with confidence/warnings
- Persists entries only after passing validation (and optional user confirmation)

Single source of truth for mapping text to entry payloads.

### 2) External API Layer
Add server-to-server endpoint(s), e.g.:
- `POST /api/ingest` (multi-mode)
- Optional explicit endpoints: `POST /api/ingest/goal`, etc.

Input modes:
- Structured mode: caller sends explicit `kind` + fields
- Freeform mode: caller sends text, backend classifies/extracts

Security for MVP:
- API key auth
- Request size limits
- Rate limiting
- Idempotency key support (prevents duplicate inserts)

### 3) MCP Tool Layer
Expose MCP tools that call the same ingestion service:
- `create_goal`, `create_practice`, `create_match`, `create_diet`, `create_exercise`
- Optional: `ingest_freeform` tool

MCP should not introduce separate write paths; use same validation and persistence path as API/UI.

### 4) In-App Codex Journal UI
Add a capture flow for freeform text:
- User enters text in textarea
- Backend calls Codex/LLM extraction
- Backend returns structured candidate entries
- UI shows preview/edit/confirm
- User confirms -> create entries

Do not auto-commit entries silently from AI output.

## Data Contract (Recommended)
Define strict schemas for extracted output:
- `kind`: one of `goal|practice|match|diet|exercise`
- `fields`: normalized per kind
- `confidence`: numeric 0..1
- `warnings`: array of strings
- `source`: `api|mcp|journal-ai|manual`

For freeform extraction, support multiple entries from one note.

## Suggested API Contract (MVP)

### `POST /api/ingest`
Request:
- `mode`: `structured` | `freeform`
- `idempotencyKey` (optional but recommended)
- `items` (structured mode) or `text` (freeform mode)
- `dryRun` (optional): parse/validate only, no DB write

Response:
- `accepted`: boolean
- `created`: array of `{ kind, id }`
- `candidates`: parsed entries (for preview/dry run)
- `warnings`: list of non-fatal issues
- `errors`: validation failures

## Auth and Permissions
- Keep browser auth/session flow unchanged for app users
- API/MCP ingestion uses separate auth (API key/JWT)
- Enforce per-key scopes if possible:
  - read-only
  - ingest-only
  - full write

## Observability and Safety
- Log ingestion metadata (not sensitive secrets):
  - source
  - mode
  - parse outcome
  - validation outcome
  - created entry IDs
- Track failure reasons (`unknown kind`, missing required fields, low confidence)
- Include deterministic idempotency handling for retries
- Add timeout/retry policy around model calls

## Rollout Plan

### Phase 1: Core Ingestion Library
- Build normalize/validate module
- Add tests for each entry type
- Add freeform-to-candidate mapper interface

### Phase 2: External Ingest API
- Add `POST /api/ingest`
- API key auth, rate limiting, idempotency
- Add dry-run mode

### Phase 3: Codex Journal Capture UI
- Add textarea capture page/component
- Add candidate preview + manual edit + confirm
- Persist via existing create functions

### Phase 4: MCP Integration
- Add MCP tools backed by same ingestion service
- Reuse API auth/rules where practical

### Phase 5: Hardening
- Improve prompts/schema constraints
- Add more tests and telemetry dashboards
- Tune confidence thresholds and fallback UX

## Open Questions
- Should low-confidence extraction block save or allow save with warning?
- Do we need user-level ownership mapping for API key writes?
- Should API and MCP writes require explicit `userId` target?
- Do we allow partial success for multi-entry ingestion?

## Recommended First Build
Start with Phase 1 + Phase 2.

Reason:
- Immediate value for integrations
- Provides stable backend foundation for both MCP and in-app Codex journal flow
- Reduces rework when adding UI and tooling later

---

If this plan is accepted, next step is to draft concrete TypeScript interfaces and Zod schemas for each ingestion mode and entry type.
