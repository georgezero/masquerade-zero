#!/usr/bin/env bash
# Run a full eval: models × variants, score each run, generate SUMMARY.md.
#
# Usage:
#   bash scripts/run-benchmark-eval.sh [options]
#
# Options (flags override env vars):
#   --base-url <url>       LLM API base URL  (env: BASE_URL, default: http://192.168.86.21:1234/v1)
#   --model <name>         Single model to test, space/comma-separated for multiple
#                          (env: EVAL_MODELS, default: all three models)
#   --variant <name>       Prompt variant: standard|compact|both
#                          (env: EVAL_VARIANTS, default: both)
#   --api-key <key>        Bearer token      (env: API_KEY, default: lmstudio)
#   --samples <file>       Samples JSON file (env: SAMPLES_FILE)
#   --timeout <sec>        Per-request timeout seconds (env: REQ_TIMEOUT_SEC, default: 180)
#   --timestamp <ts>       Override output timestamp
#
# Examples:
#   # Single model, single variant, different server:
#   bash scripts/run-benchmark-eval.sh --base-url http://192.168.86.28/v1 \
#       --model liquid/lfm2.5-1.2b --variant compact
#
#   # Two models, both variants, custom key:
#   bash scripts/run-benchmark-eval.sh --model "openai/gpt-oss-20b,gemma-3-1b-it-qat" \
#       --variant both --api-key mykey
#
# Outputs to: benchmark-results/journal-evals/<timestamp>/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

# ---- defaults from env ----
TIMESTAMP="${EVAL_TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"
MODELS="${EVAL_MODELS:-openai/gpt-oss-20b liquid/lfm2.5-1.2b gemma-3-1b-it-qat}"
VARIANTS="${EVAL_VARIANTS:-standard compact}"
SAMPLES_FILE="${SAMPLES_FILE:-sample-data/journal-llm-samples-prose-no-dates.json}"
BASE_URL="${BASE_URL:-http://192.168.86.21:1234/v1}"
API_KEY="${API_KEY:-lmstudio}"
REQ_TIMEOUT_SEC="${REQ_TIMEOUT_SEC:-180}"

# ---- parse flags (override env) ----
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)  BASE_URL="$2";        shift 2 ;;
    --model)     MODELS="${2//,/ }";   shift 2 ;;
    --variant)
      if [[ "$2" == "both" ]]; then
        VARIANTS="standard compact"
      else
        VARIANTS="${2//,/ }"
      fi
      shift 2 ;;
    --api-key)   API_KEY="$2";         shift 2 ;;
    --samples)   SAMPLES_FILE="$2";    shift 2 ;;
    --timeout)   REQ_TIMEOUT_SEC="$2"; shift 2 ;;
    --timestamp) TIMESTAMP="$2";       shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Extract host+port from BASE_URL for use in directory name (e.g. "192.168.86.28-1234")
SERVER_SLUG=$(echo "$BASE_URL" | sed -E 's|https?://||; s|/.*||; s|:|-|')
EVAL_DIR="benchmark-results/journal-evals/${TIMESTAMP}-${SERVER_SLUG}"
mkdir -p "$EVAL_DIR"

echo "========================================================"
echo "Journal LLM Benchmark Eval"
echo "Timestamp : $TIMESTAMP"
echo "Eval dir  : $EVAL_DIR"
echo "Base URL  : $BASE_URL"
echo "Models    : $MODELS"
echo "Variants  : $VARIANTS"
echo "Samples   : $SAMPLES_FILE"
echo "========================================================"
echo ""

run_count=0
total_runs=$(echo $MODELS | wc -w)
total_runs=$(($(echo $MODELS | wc -w) * $(echo $VARIANTS | wc -w)))

for model in $MODELS; do
  for variant in $VARIANTS; do
    run_count=$((run_count + 1))
    safe_model="${model//\//-}"
    run_label="${safe_model}-${variant}"
    run_dir="$EVAL_DIR/$run_label"
    mkdir -p "$run_dir"

    echo "────────────────────────────────────────────────────────"
    echo "Run $run_count/$total_runs: model=$model  variant=$variant"
    echo "Output: $run_dir"
    echo "────────────────────────────────────────────────────────"

    # Wait for server to be healthy before each run (up to 5 minutes)
    echo "  Checking server health..."
    for attempt in $(seq 1 20); do
      if curl -s --max-time 10 "$BASE_URL/models" -H "Authorization: Bearer $API_KEY" | grep -q '"id"'; then
        echo "  Server ready (attempt $attempt)"
        break
      fi
      echo "  Server not ready (attempt $attempt/20), waiting 15s..."
      sleep 15
    done
    # Brief settle time between runs
    if [ "$run_count" -gt 1 ]; then sleep 10; fi

    score_json="$run_dir/score-results.json"

    # Run benchmark, capture log; scorer invoked inside benchmark script but we
    # override it here with full args (model/variant labels + JSON output path).
    set +e
    OUT_DIR="$run_dir" \
      MODEL="$model" \
      PROMPT_VARIANT="$variant" \
      SAMPLES_FILE="$SAMPLES_FILE" \
      BASE_URL="$BASE_URL" \
      API_KEY="$API_KEY" \
      REQ_TIMEOUT_SEC="$REQ_TIMEOUT_SEC" \
      BENCHMARK_SKIP_SCORE=1 \
      bash scripts/benchmark-journal-lan.sh 2>&1 | tee "$run_dir/benchmark.log"
    benchmark_exit=$?
    set -e

    # Run scorer separately with full labels and JSON output
    if command -v node >/dev/null 2>&1; then
      node scripts/score-journal-benchmark.js \
        "$SAMPLES_FILE" \
        "$run_dir" \
        --model "$model" \
        --variant "$variant" \
        --output "$score_json" 2>&1 | tee -a "$run_dir/benchmark.log" || true
    fi

    if [ "$benchmark_exit" -ne 0 ]; then
      echo "  ⚠ benchmark exited with code $benchmark_exit (some samples may have failed)"
    fi
    echo ""
  done
done

echo "========================================================"
echo "All runs complete. Generating SUMMARY.md..."
node scripts/summarize-benchmark-eval.js "$EVAL_DIR"
echo ""
echo "Results saved to: $EVAL_DIR"
echo "SUMMARY.md: $EVAL_DIR/SUMMARY.md"
echo "========================================================"
