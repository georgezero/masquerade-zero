#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://192.168.86.21:1234/v1}"
MODEL="${MODEL:-gemma-3-1b-it-qat}"
API_KEY="${API_KEY:-lmstudio}"
SAMPLES_FILE="${SAMPLES_FILE:-sample-data/journal-llm-samples-prose-no-dates.json}"
REQ_TIMEOUT_SEC="${REQ_TIMEOUT_SEC:-120}"

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required." >&2
  exit 1
fi

SYSTEM_PROMPT=$(cat <<'EOF'
Analyze a tennis journal entry and output a single JSON object. No other text.

Output format:
{"mood":"...","intensity":"...","format":"...","tags":[],"confidence":0.9}

Fields:
- mood: overall emotional tone → positive | neutral | negative
  positive: won, felt good, things clicked, breakthrough, energized, proud
  negative: lost, frustrated, tired, struggled, disappointed, off-day
  neutral: mixed or matter-of-fact, neither clearly positive nor negative
- intensity: effort level of the primary activity → high | medium | low
- format: session type → formal | informal
  formal = coached session or competitive match
  informal = everything else (solo, unstructured, cross-training, recovery)
- tags: array from: tactical, physical, mental, coach, match-play, recovery, nutrition, social, breakthrough, struggle, fun
- confidence: 0.0-1.0

Rules:
1. JSON object only. No markdown fences, no explanation.
2. Exactly one value each for mood, intensity, format.
3. tags may be [] or contain multiple values — only use words from the list above.
EOF
)

OUT_DIR="${OUT_DIR:-.runtime/sentiment-benchmark-${MODEL//\//-}}"
mkdir -p "$OUT_DIR"

pass_count=0
fail_count=0
total=0

while IFS= read -r row_b64; do
  total=$((total+1))
  row_json="$(printf '%s' "$row_b64" | base64 -d)"
  id="$(printf '%s' "$row_json" | jq -r '.id')"
  title="$(printf '%s' "$row_json" | jq -r '.title')"
  text="$(printf '%s' "$row_json" | jq -r '.text')"

  out_raw="$OUT_DIR/${total}-${id}.raw.json"
  out_content="$OUT_DIR/${total}-${id}.content.txt"
  out_clean="$OUT_DIR/${total}-${id}.clean.txt"
  out_meta="$OUT_DIR/${total}-${id}.meta.txt"

  payload="$(jq -nc --arg model "$MODEL" --arg sys "$SYSTEM_PROMPT" --arg usr "$text" \
    '{model:$model,temperature:0,messages:[{role:"system",content:$sys},{role:"user",content:$usr}]}')"

  if [ "$total" -gt 1 ]; then sleep "${INTER_SAMPLE_SLEEP_SEC:-2}"; fi

  start_ms=$(date +%s%3N)
  http_code=$(curl -sS -m "$REQ_TIMEOUT_SEC" "$BASE_URL/chat/completions" \
    -H "Authorization: Bearer $API_KEY" \
    -H 'Content-Type: application/json' \
    -o "$out_raw" \
    -w '%{http_code}' \
    --data "$payload" || echo "000")
  end_ms=$(date +%s%3N)
  dur_ms=$((end_ms-start_ms))

  content="$(jq -r '.choices[0].message.content // empty' "$out_raw" 2>/dev/null || true)"
  printf '%s\n' "$content" > "$out_content"

  clean="$(printf '%s' "$content" | perl -0777 -pe 's/<think>.*?<\/think>//gs' | sed -E 's/^```[A-Za-z0-9_-]*[[:space:]]*//; s/[[:space:]]*```$//' )"
  printf '%s\n' "$clean" > "$out_clean"

  status="FAIL"
  reason=""

  if [ "$http_code" != "200" ]; then
    reason="HTTP $http_code"
  elif [ -z "${clean//[[:space:]]/}" ]; then
    reason="Empty content"
  elif ! printf '%s' "$clean" | jq -e . >/dev/null 2>&1; then
    reason="Invalid JSON"
  elif printf '%s' "$clean" | jq -e 'type=="array"' >/dev/null 2>&1; then
    # Some models wrap in array — still PASS if first element has required keys
    if printf '%s' "$clean" | jq -e '.[0] | (has("mood") and has("intensity") and has("format") and has("tags"))' >/dev/null 2>&1; then
      status="PASS"
      reason="OK (array-wrapped)"
    else
      reason="Array: missing required keys"
    fi
  elif printf '%s' "$clean" | jq -e 'has("mood") and has("intensity") and has("format") and has("tags")' >/dev/null 2>&1; then
    status="PASS"
    reason="OK"
  else
    reason="Missing required keys (mood/intensity/format/tags)"
  fi

  if [ "$status" = "PASS" ]; then
    pass_count=$((pass_count+1))
  else
    fail_count=$((fail_count+1))
  fi

  {
    echo "id=$id"
    echo "title=$title"
    echo "http_code=$http_code"
    echo "duration_ms=$dur_ms"
    echo "status=$status"
    echo "reason=$reason"
  } > "$out_meta"

  echo "[$total] $id :: $title"
  echo "  http=$http_code duration_ms=${dur_ms}ms status=$status reason=$reason"
done < <(jq -r '.[] | @base64' "$SAMPLES_FILE")

echo "============================================================"
echo "MODEL=$MODEL"
echo "BASE_URL=$BASE_URL"
echo "TOTAL=$total PASS=$pass_count FAIL=$fail_count"
echo "ARTIFACTS=$OUT_DIR"

# Run scorer unless suppressed
if [ "${BENCHMARK_SKIP_SCORE:-0}" != "1" ] && command -v node >/dev/null 2>&1 && [ -f "scripts/score-sentiment-benchmark.js" ]; then
  node scripts/score-sentiment-benchmark.js "$SAMPLES_FILE" "$OUT_DIR" \
    --model "$MODEL" || true
fi

[ "$fail_count" -eq 0 ]
