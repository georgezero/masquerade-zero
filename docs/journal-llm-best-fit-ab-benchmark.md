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
