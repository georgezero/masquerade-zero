# Plan: Journal List + Journal Detail Views

## Objective
Add a user-facing journal history and journal detail experience so users can:
1. view all journals in a list
2. open a specific journal in a read-only detail view
3. see entries created from that journal
4. inspect candidate statuses (saved/dismissed/pending)

## Why this matters
The current `/journal` flow supports capture/preview/finalize/save, but users cannot easily browse prior journals or audit what was saved vs dismissed from each journal. This plan adds that visibility.

## Existing foundations (already implemented)
- `journal_submissions` table (raw text + status)
- `journal_submission_candidates` table (candidate payload + status)
- `journal_submission_entries` table (links created entries back to journal)
- Finalize/dismiss/save statuses in journal workflow

## Product Scope
### New pages/routes
- `GET /journals`
  - list all journals for current user
  - show timestamp, status, short excerpt
  - show counts: saved entries, dismissed candidates, pending candidates
- `GET /journal/:id`
  - read-only journal detail
  - full raw text
  - candidate list with status/confidence
  - linked saved entries with links to `/view/:kind/:id`

### Navigation updates
- Add links from:
  - home page (`/`) -> Journals
  - journal workspace (`/journal`) -> View All Journals

## UX Details
### `/journals` list
Each row/card includes:
- journal id (shortened for display)
- created/updated timestamp
- status badge (`draft` / `finalized`)
- raw text excerpt
- summary counts (saved/dismissed/pending)
- “Open” link to `/journal/:id`

### `/journal/:id` detail
Sections:
1. Metadata (id, status, created, updated)
2. Raw journal text (exact, preserved formatting)
3. Candidates table/cards
   - index, kind, confidence, status
4. Created entries table/cards
   - kind, created timestamp, link to `/view/:kind/:id`

## Backend/Query Plan
Add helpers (likely in `src/lib/app.ts`):
- `listJournals(userId, limit, offset)`
- `getJournalDetail(userId, journalId)` returning:
  - submission row
  - candidate rows
  - linked entry rows

Implementation notes:
- filter all queries by `userId`
- sort list by `updated_at DESC`
- use basic pagination params (`limit`, `offset`)

## Template Plan
Add template functions in `src/templates.ts`:
- `journalsList(...)`
- `journalDetail(...)`

Styling approach:
- reuse existing glass/neon style system
- status badges:
  - draft: amber
  - finalized: cyan
  - saved: emerald
  - dismissed: slate
  - pending: amber

## Rollout Plan
### Step 1
Implement `GET /journals` list + navigation links.

### Step 2
Implement `GET /journal/:id` detail view with raw text and candidate statuses.

### Step 3
Add linked entries section (from `journal_submission_entries`) with direct links to `/view/:kind/:id`.

### Step 4
Add pagination/filter controls (optional if list grows).

## Test Plan
### Automated
- Unit tests for list/detail query mapping
- Route-level checks for auth + ownership filtering

### Manual
1. Create journal with multiple lines
2. Save one candidate, dismiss one, leave one pending
3. Verify `/journals` counts match
4. Verify `/journal/:id` shows raw text + accurate statuses + saved entry links

## Non-goals (for now)
- Editing finalized journal text
- Reopening finalized journals for mutation
- Entry detail backlink to source journal (can be added later)

## Future extension
Add "Edit historical journal" flow on a separate page/workflow, not in current capture page.
