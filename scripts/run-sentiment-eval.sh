#!/usr/bin/env bash
# Run sentiment benchmark: all models × both sample sets, one server.
#
# Usage:
#   bash scripts/run-sentiment-eval.sh [options]
#
# Options:
#   --base-url <url>    LLM API base URL  (default: http://192.168.86.21:1234/v1)
#   --model <name>      Comma/space-separated model names (default: all three)
#   --api-key <key>     Bearer token (default: lmstudio)
#   --timeout <sec>     Per-request timeout (default: 120)
#   --timestamp <ts>    Override output timestamp
#
# Outputs to: benchmark-results/sentiment-evals/<timestamp>-<server>/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

TIMESTAMP="${EVAL_TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"
MODELS="${EVAL_MODELS:-openai/gpt-oss-20b liquid/lfm2.5-1.2b gemma-3-1b-it-qat}"
BASE_URL="${BASE_URL:-http://192.168.86.21:1234/v1}"
API_KEY="${API_KEY:-lmstudio}"
REQ_TIMEOUT_SEC="${REQ_TIMEOUT_SEC:-120}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)  BASE_URL="$2";          shift 2 ;;
    --model)     MODELS="${2//,/ }";     shift 2 ;;
    --api-key)   API_KEY="$2";           shift 2 ;;
    --timeout)   REQ_TIMEOUT_SEC="$2";   shift 2 ;;
    --timestamp) TIMESTAMP="$2";         shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

SAMPLE_SETS=(
  "sample-data/journal-llm-samples-prose-no-dates.json:prose-nd"
  "sample-data/journal-llm-samples-prose-college-balance.json:college"
)

SERVER_SLUG=$(echo "$BASE_URL" | sed -E 's|https?://||; s|/.*||; s|:|-|')
EVAL_DIR="benchmark-results/sentiment-evals/${TIMESTAMP}-${SERVER_SLUG}"
mkdir -p "$EVAL_DIR"

total_runs=$(echo $MODELS | wc -w)
total_runs=$((total_runs * ${#SAMPLE_SETS[@]}))
run_count=0

echo "========================================================"
echo "Sentiment Benchmark Eval"
echo "Timestamp : $TIMESTAMP"
echo "Eval dir  : $EVAL_DIR"
echo "Base URL  : $BASE_URL"
echo "Models    : $MODELS"
echo "Samples   : ${#SAMPLE_SETS[@]} files"
echo "Total runs: $total_runs"
echo "========================================================"
echo ""

for model in $MODELS; do
  for sample_entry in "${SAMPLE_SETS[@]}"; do
    samples_file="${sample_entry%%:*}"
    sample_slug="${sample_entry##*:}"

    run_count=$((run_count + 1))
    safe_model="${model//\//-}"
    run_label="${safe_model}-${sample_slug}"
    run_dir="$EVAL_DIR/$run_label"
    mkdir -p "$run_dir"

    echo "────────────────────────────────────────────────────────"
    echo "Run $run_count/$total_runs: model=$model  samples=$sample_slug"
    echo "Output: $run_dir"
    echo "────────────────────────────────────────────────────────"

    # Wait for server to be healthy (up to 5 minutes)
    echo "  Checking server health..."
    for attempt in $(seq 1 20); do
      if curl -s --max-time 10 "$BASE_URL/models" -H "Authorization: Bearer $API_KEY" | grep -q '"id"'; then
        echo "  Server ready (attempt $attempt)"
        break
      fi
      echo "  Server not ready (attempt $attempt/20), waiting 15s..."
      sleep 15
    done

    if [ "$run_count" -gt 1 ]; then sleep 8; fi

    score_json="$run_dir/score-results.json"

    set +e
    OUT_DIR="$run_dir" \
      MODEL="$model" \
      SAMPLES_FILE="$samples_file" \
      BASE_URL="$BASE_URL" \
      API_KEY="$API_KEY" \
      REQ_TIMEOUT_SEC="$REQ_TIMEOUT_SEC" \
      BENCHMARK_SKIP_SCORE=1 \
      bash scripts/benchmark-sentiment-lan.sh 2>&1 | tee "$run_dir/benchmark.log"
    benchmark_exit=$?
    set -e

    if command -v node >/dev/null 2>&1; then
      node scripts/score-sentiment-benchmark.js \
        "$samples_file" \
        "$run_dir" \
        --model "$model" \
        --variant "$sample_slug" \
        --output "$score_json" 2>&1 | tee -a "$run_dir/benchmark.log" || true
    fi

    if [ "$benchmark_exit" -ne 0 ]; then
      echo "  ⚠ benchmark exited with code $benchmark_exit"
    fi
    echo ""
  done
done

echo "========================================================"
echo "All $total_runs runs complete for $SERVER_SLUG"
echo "Results: $EVAL_DIR"
echo "========================================================"
