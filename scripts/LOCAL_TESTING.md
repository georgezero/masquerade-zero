# Local Testing (Scripts)

This folder includes automation scripts for ingest and journal LLM checks.

## Journal LLM sample batch (10 notes)

Script:

```bash
./scripts/test-journal-llm-samples.sh
```

Inputs:
- `sample-data/journal-llm-samples.json`

Outputs:
- per-sample artifacts in `.runtime/journal-llm-sample-results/`
- `*.meta.txt` summary files
- `*.html` (cookie mode) or `*.json` (test-key mode)

## Mode A: No-auth local test endpoint (recommended)

Prerequisites:
1. App running locally (for example `PORT=3003 npm run dev`)
2. `.env` contains `JOURNAL_LLM_TEST_PREVIEW_KEY`

Run:

```bash
TEST_KEY='local-journal-test-key' \
APP_URL='http://localhost:3003' \
MODEL='openai/gpt-oss-20b' \
COMPARE_MODELS=true \
./scripts/test-journal-llm-samples.sh
```

This mode calls:
- `POST /api/journal/preview-test`
- header: `x-journal-test-key: <TEST_KEY>`

## Mode B: Authenticated HTML endpoint

Run:

```bash
SESSION_COOKIE='neon-auth-session=<cookie-value>' \
APP_URL='https://tennis-zero-six-alpha-journal-llm.fff.ad' \
MODEL='openai/gpt-oss-20b' \
COMPARE_MODELS=true \
./scripts/test-journal-llm-samples.sh
```

This mode calls:
- `POST /api/journal/preview`

## Useful overrides

```bash
MODEL='qwen3.5-9b-mlx'
COMPARE_MODELS=false
SAMPLES_FILE='sample-data/journal-llm-samples.json'
OUT_DIR='.runtime/journal-llm-sample-results'
```
