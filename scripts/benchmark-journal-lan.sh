#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://192.168.86.21:1234/v1}"
MODEL="${MODEL:-gemma-3-1b-it-qat}"
API_KEY="${API_KEY:-lmstudio}"
SAMPLES_FILE="${SAMPLES_FILE:-sample-data/journal-llm-samples-prose-no-dates.json}"
# PROMPT_VARIANT: "auto" (default), "standard", or "compact"
# auto = use compact for ≤3B models (matches "1b", "1.2b", "2b", etc.), standard otherwise
PROMPT_VARIANT="${PROMPT_VARIANT:-auto}"
REQ_TIMEOUT_SEC="${REQ_TIMEOUT_SEC:-180}"

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required." >&2
  exit 1
fi

SYSTEM_PROMPT_STANDARD=$(cat <<'EOF'
You convert tennis journal text into structured JSON entries.
Convert input text into one or more entries using only this schema:
Goal: weekStart (YYYY-MM-DD), planText
Practice: date (YYYY-MM-DD), withCoach (true|false), coachName (string|null), workedOn, notes
Match: date (YYYY-MM-DD), opponent, score, notes
Diet: date (YYYY-MM-DD), summary
Exercise: date (YYYY-MM-DD), durationMin (positive integer), exerciseType (Strength|Cardio|Mobility|Recovery|Other), notes
Rules:
1. Return JSON array only. No markdown, no prose, no wrapper objects.
2. Each item must be {"kind":"goal|practice|match|diet|exercise","fields":{...},"confidence":0.0-1.0,"warnings":[]}.
3. Use only allowed fields for the chosen kind. No extra field names.
4. Always emit at least one best-fit entry when there is any meaningful tennis, goal, diet, or exercise signal.
5. Do not invent specific people, scores, or dates.
6. If date/weekStart is missing, leave blank and add warning.
7. Safe defaults when uncertain: withCoach=false, coachName=null, score="", durationMin=30, exerciseType=Other.
8. Return [] only if truly no relevant signal.
EOF
)

# Compact variant: ~40% fewer tokens, disambiguates practice vs exercise,
# makes multi-entry requirement explicit. Better for ≤3B parameter models.
SYSTEM_PROMPT_COMPACT=$(cat <<'EOF'
Extract structured entries from a tennis journal. Output ONLY a JSON array, nothing else.

Entry format: {"kind":"...","fields":{...},"confidence":0.9,"warnings":[]}

Kinds and fields:
- practice (on-court tennis session): date, workedOn, withCoach(true/false), coachName(null), notes
- match (competitive game played): date, opponent, score, notes
- diet (food, meals, nutrition): date, summary
- exercise (off-court: gym, cardio, bike, mobility, stretching): date, durationMin, exerciseType(Strength|Cardio|Mobility|Recovery|Other), notes
- goal (weekly training plan): weekStart, planText

Rules:
1. A single journal may produce multiple entries. Example: tennis + gym + dinner = [practice, exercise, diet].
2. Always emit at least one entry. Never return [].
3. Leave date blank if not stated in the text. Defaults: withCoach=false, coachName=null, durationMin=30, exerciseType=Other.
4. JSON array only. No markdown fences, no explanation text.
EOF
)

# Auto-select prompt variant based on model name when PROMPT_VARIANT=auto.
# Matches small models: 1b, 1.2b, 1.5b, 2b, 2.7b, etc. (but not 7b, 20b).
if [ "$PROMPT_VARIANT" = "auto" ]; then
  if echo "$MODEL" | grep -qiE '1b[^0-9]|1b$|[0-9]\.[0-9]+b([^0-9]|$)'; then
    PROMPT_VARIANT="compact"
  else
    PROMPT_VARIANT="standard"
  fi
fi

if [ "$PROMPT_VARIANT" = "compact" ]; then
  SYSTEM_PROMPT="$SYSTEM_PROMPT_COMPACT"
else
  SYSTEM_PROMPT="$SYSTEM_PROMPT_STANDARD"
fi

OUT_DIR="${OUT_DIR:-.runtime/journal-lan-benchmark-${MODEL//\//-}-${PROMPT_VARIANT}}"
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

  payload="$(jq -nc --arg model "$MODEL" --arg sys "$SYSTEM_PROMPT" --arg usr "Today's date is 2026-03-18.\n\nJournal entry:\n$text" '{model:$model,temperature:0,messages:[{role:"system",content:$sys},{role:"user",content:$usr}]}')"

  # Brief pause between API calls to avoid overwhelming the local server
  if [ "$total" -gt 1 ]; then sleep "${INTER_SAMPLE_SLEEP_SEC:-3}"; fi

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
  candidates=0

  if [ "$http_code" != "200" ]; then
    reason="HTTP $http_code"
  elif [ -z "${clean//[[:space:]]/}" ]; then
    reason="Empty content"
  elif ! printf '%s' "$clean" | jq -e . >/dev/null 2>&1; then
    reason="Invalid JSON"
  else
    candidates=$(printf '%s' "$clean" | jq 'if type=="array" then length else 0 end' 2>/dev/null || echo 0)
    if printf '%s' "$clean" | jq -e 'type=="array" and length>0 and all(.[]; (has("kind") and has("fields") and (.fields|type=="object")))' >/dev/null 2>&1; then
      status="PASS"
      reason="OK"
    else
      reason="Schema mismatch or zero candidates"
    fi
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
    echo "candidates=$candidates"
  } > "$out_meta"

  echo "[$total] $id :: $title"
  echo "  http=$http_code duration_ms=$dur_ms candidates=$candidates status=$status reason=$reason"
done < <(jq -r '.[] | @base64' "$SAMPLES_FILE")

echo "============================================================"
echo "MODEL=$MODEL"
echo "PROMPT_VARIANT=$PROMPT_VARIANT"
echo "BASE_URL=$BASE_URL"
echo "TOTAL=$total PASS=$pass_count FAIL=$fail_count"
echo "ARTIFACTS=$OUT_DIR"

# Run scorer unless suppressed (set BENCHMARK_SKIP_SCORE=1 when orchestrator calls separately)
if [ "${BENCHMARK_SKIP_SCORE:-0}" != "1" ] && command -v node >/dev/null 2>&1 && [ -f "scripts/score-journal-benchmark.js" ]; then
  node scripts/score-journal-benchmark.js "$SAMPLES_FILE" "$OUT_DIR" || true
fi

[ "$fail_count" -eq 0 ]
