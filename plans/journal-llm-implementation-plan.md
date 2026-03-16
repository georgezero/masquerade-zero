# Plan: TZ Journal LLM Extraction

## Objective
Add LLM-powered journal extraction that maps freeform journal text into structured Tennis Zero entry candidates (`goal`, `practice`, `match`, `diet`, `exercise`) while preserving safety, traceability, and existing validation guarantees.

## Constraints
- Reuse existing ingestion pipeline and create functions.
- Never bypass schema validation.
- Keep model calls server-side only.
- Preserve raw journal text as-is.
- Keep deterministic parser as fallback.

## Existing Foundations (already in branch)
- Shared ingestion module (`src/ingest/*`) with strict validation.
- Journal draft/finalize flow with persisted `journalId`.
- Candidate persistence (`journal_submission_candidates`) and entry links (`journal_submission_entries`).
- Scoped ingest API keys + durable rate-limit/idempotency.

## User Experience Goals
1. User writes journal text in `/journal`.
2. Clicks `Preview Candidates`.
3. Backend attempts LLM extraction.
4. UI shows candidate cards (with confidence/warnings/source markers).
5. User confirms/dismisses per candidate (current behavior remains).

Out-of-scope for this phase:
- Fully automatic no-confirm save mode.
- Editing historical finalized journals.

## Architecture
### LLM extractor layer
Add `src/ingest/llm.ts` with:
- `extractJournalCandidatesLLM(text: string): Promise<StructuredIngestInput[]>`
- provider-agnostic interface + one concrete provider implementation

### Extraction pipeline in `/api/journal/preview`
1. Persist/update draft raw text.
2. Try LLM extraction.
3. Validate extracted items with existing ingestion dry-run.
4. If LLM fails/invalid, fallback to deterministic parser (`parseFreeformJournalToStructuredItems`).
5. Return candidates + warnings + source metadata.

### Source attribution
Each candidate should carry source metadata:
- `source`: `journal-ai` (LLM) or fallback marker
- warning if fallback was used
- optional source span/snippet for explainability

## Data Contract for LLM Output
Require strict JSON list with fields:
- `kind`: `goal|practice|match|diet|exercise`
- `fields`: object (kind-specific)
- `confidence`: number 0..1
- `warnings`: string[]
- optional: `sourceSpan` (line range or snippet)

Any invalid output is rejected and repaired via fallback parser.

## Prompting Strategy
### System prompt rules
- Extract only explicitly supported facts.
- Do not invent missing facts.
- Prefer empty/default fields + warnings when uncertain.
- Return valid JSON only (no prose).

### Few-shot examples
Include examples for:
- mixed multi-kind journal blocks
- ambiguous lines
- multiple same-kind entries
- bullet/ordered list notes

## Config and Flags
Add env controls:
- `JOURNAL_LLM_ENABLED` (`true|false`, default `false`)
- `JOURNAL_LLM_PROVIDER` (e.g. `openai`)
- provider credentials/model env vars
- `JOURNAL_LLM_TIMEOUT_MS`

Behavior:
- if disabled/unconfigured -> deterministic parser only
- if enabled but request fails -> fallback parser + warning

## Reliability and Safety
- Timeout + retry policy for model call.
- Request size cap before model invocation.
- Telemetry events:
  - `journal_llm_extract_success`
  - `journal_llm_extract_failure`
  - `journal_llm_fallback_used`
  - candidate counts / validation failures

## Testing Plan
### Unit
- parse LLM JSON output -> structured items
- invalid JSON / schema mismatch -> fallback path
- confidence/warnings propagation

### Integration
- `/api/journal/preview` with mocked LLM success
- `/api/journal/preview` with mocked failure and fallback parser
- confirm/dismiss flow unchanged with LLM candidates

### Manual QA
- journal text with mixed entry types
- multiple same-kind entries
- ambiguous text that should produce warnings
- large text / timeout behavior

## Rollout Phases
### Phase LLM-1 (safe rollout)
- Feature-flagged LLM preview extraction
- deterministic fallback always available
- no behavior changes in confirm/dismiss/finalize

### Phase LLM-2
- Show source indicators in UI (LLM vs fallback)
- Tune prompt/examples from real user data

### Phase LLM-3 (optional)
- Add alternate "Process with LLM" path that can auto-save high-confidence entries
- keep auditable summary before write in production

## Definition of Done
- LLM extraction integrated behind feature flag.
- Preview works with LLM success and fallback paths.
- All candidates still pass existing schema validation.
- Existing journal save/dismiss/finalize flows remain stable.
- Automated tests cover success + fallback + error paths.
