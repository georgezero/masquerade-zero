# Journal Dev Benchmark Eval UI (March 2026)

This document captures the `/journal-dev-benchmark` UX and evaluation tooling updates added during March 2026.

## Scope Added

- Split parse workflow into two independent subpanels:
  - `Parse Journal` (entry extraction)
  - `Parse Journal Sentiment` (sentiment extraction)
- Each subpanel now has independent:
  - model selection (persisted in localStorage)
  - parse action
  - debug prompt/output blocks
  - output rendering
- Added independent compare toggles:
  - `Compare models` for entries
  - `Compare models` for sentiment
- Added benchmark label display in sample header:
  - `Expected Entries`
  - `Expected Sentiment`

## Benchmark Label Support

The benchmark loader now supports both entry label formats:

1. `expectedEntryKinds`:

```json
{
  "expectedEntryKinds": ["practice", "diet"]
}
```

2. `expected` with `{kind, date}` entries:

```json
{
  "expected": [
    {"kind": "practice", "date": null},
    {"kind": "diet", "date": null}
  ]
}
```

Both map into the same `Expected Entries` display/eval path.

## Eval Sections Added

## Parse Journal Eval

- `Model: ...`
- `Overall Score`
- Formula hint: `overall = exact-set ? 1.0 : F1(kind set)`
- Metrics:
  - exact set match
  - precision / recall / F1
  - TP/FP/FN
- Visual expected vs predicted kind chips
- Explicit `Extra predicted kinds` when present
- `Copy Eval` button (Markdown summary)

## Parse Journal Sentiment Eval

- `Model: ...`
- `Overall Score`
- Formula hint: `overall = avg(mood, intensity, format, tag-F1)` (or without tag-F1 when no expected tags)
- Metrics:
  - all-fields exact
  - mood/intensity/format match status
  - tag F1
- Visual expected vs predicted tags
- Explicit `Extra predicted tags` when present
- `Copy Eval` button (Markdown summary)

## UX Updates

- Eval blocks render before debug blocks.
- Debug prompt/output are collapsed by default:
  - `Show Debug LLM Prompt and Output (N)`
- Parsed entry cards are collapsed by default:
  - `Show Parsed Entries (N)`
- Overall score style:
  - neutral, high-visibility sky accent (non-judgmental color)
- Parse submit button behavior:
  - parse buttons show yellow `Parsing...` state during request
- Parse Journal model compare block moved below parsed entries details.
- Trailing slash redirects enabled through Hono `trimTrailingSlash` middleware.

## Infra / Runtime Notes

- Cloudflare tunnel created for remote benchmark testing:
  - `tennis-zero-dev-benchmarking.mllm.bet`
- Benchmark runtime has been tested against LAN LLM endpoint(s), including `.28:1234/v1`.

## TODO

- Add optional JSON export for eval copy (`Copy Eval as JSON`).
- Add aggregate multi-sample rollup panel (running totals and per-model summary).
- Add optional confusion-matrix style view for entry-kind classification.
- Add optional CSV export for benchmarking runs.
- Consider storing eval snapshots per sample/model for regression tracking over time.
