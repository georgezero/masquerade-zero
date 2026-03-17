# Journal LLM Best-Fit Prompt A/B Benchmark

Date: 2026-03-17
Model: `openai/gpt-oss-20b`
Endpoint: `POST /api/journal/preview-test`

## What changed

Single-pass extraction was tightened to:
- require JSON array output only,
- require schema-only fields,
- enforce "always emit best-fit entry" policy,
- keep missing details in notes/summary/planText,
- use safe defaults for uncertain fields,
- sanitize extra fields before validation.

A feature-flagged 2-pass mode (`JOURNAL_LLM_TWO_PASS=true`) remains available.

## Why it improved

The main performance gains came from three changes:
- **Single output contract**: requiring JSON-array-only output removed schema-shape drift (`[]` vs `{items:[...]}`), reducing parse failures.
- **Best-fit recall policy**: explicit instruction to always emit at least one best-fit entry prevented dropped prose samples.
- **Pre-validation sanitization**: unsupported keys are dropped and missing uncertain values are defaulted safely (`withCoach=false`, `coachName=null`, `durationMin=30`, `exerciseType=Other`) before ingest validation.

## Results

### No-date prose samples (`sample-data/journal-llm-samples-prose-no-dates.json`)

- Baseline single-pass (`.runtime/journal-llm-prose-no-dates-openai-single-bestfit-v2`)
  - pass: `5/10`
  - fallback: `5/10`
  - avg candidates: `1.10`
  - runtime: `55s`
- Baseline two-pass (`.runtime/journal-llm-prose-no-dates-openai-two-pass-v1`)
  - pass: `6/10`
  - fallback: `4/10`
  - avg candidates: `1.70`
  - runtime: `93s`
- New single-pass (`.runtime/journal-llm-prose-no-dates-openai-single-bestfit-v3`)
  - pass: `10/10`
  - fallback: `0/10`
  - avg candidates: `2.00`
  - runtime: `47s`
- New two-pass (`.runtime/journal-llm-prose-no-dates-openai-two-pass-v2`)
  - pass: `10/10`
  - fallback: `0/10`
  - avg candidates: `2.60`
  - runtime: `98s`

### Dated prose samples (`sample-data/journal-llm-samples-prose.json`)

- New single-pass (`.runtime/journal-llm-prose-dated-openai-single-bestfit-v3`)
  - pass: `10/10`
  - fallback: `0/10`
  - avg candidates: `2.00`
  - runtime: `39s`
- New two-pass (`.runtime/journal-llm-prose-dated-openai-two-pass-v2`)
  - pass: `10/10`
  - fallback: `0/10`
  - avg candidates: `2.20`
  - runtime: `93s`

## Recommendation

Given equivalent pass/fallback outcomes after prompt hardening, keep single-pass as default for latency.
Use two-pass only when higher recall density is more important than response time.

## Additional model experiments (March 17, 2026)

### `qwen3.5-9b-mlx` (single-pass, no-date prose)

- Run: `.runtime/journal-llm-prose-no-dates-qwen3.5-9b-mlx-single-pass-v1`
- Result: `10/10` pass, fallback `0/10`, avg candidates `2.00`, runtime `48s`
- Comparison vs `openai/gpt-oss-20b` on same set:
  - `openai/gpt-oss-20b`: `10/10`, `47s`
  - `qwen3.5-9b-mlx`: `10/10`, `48s`

### `qwen3.5-4b-mlx` (single-pass, no-date prose)

- Run: `.runtime/journal-llm-prose-no-dates-qwen3.5-4b-mlx-single-pass-v1`
- Result: `0/10` pass, fallback `10/10`, avg candidates `0.00`, runtime `378s`
- Root cause from logs:
  - frequent request timeouts at default timeout
  - responses often included `<think>...</think>` before JSON, which fails strict JSON parsing

### Temporary `<think>` stripping test (reverted)

- A temporary parser tweak was tested locally to strip leading `<think>...</think>` before JSON parse.
- Partial re-run showed mixed recovery (`PASS` and `FAIL` samples), but this change was reverted and not kept in code.
- Decision: keep parser strict for now; if needed, add a guarded opt-in compatibility mode later.
