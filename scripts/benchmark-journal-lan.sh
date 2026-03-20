#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://192.168.86.21:1234/v1}"
MODEL="${MODEL:-gemma-3-1b-it-qat}"
API_KEY="${API_KEY:-lmstudio}"
SAMPLES_FILE="${SAMPLES_FILE:-sample-data/journal-llm-samples-prose-no-dates.json}"
OUT_DIR="${OUT_DIR:-.runtime/journal-lan-benchmark-${MODEL//\//-}}"
REQ_TIMEOUT_SEC="${REQ_TIMEOUT_SEC:-180}"

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

SYSTEM_PROMPT=$(cat <<'EOF'
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
echo "BASE_URL=$BASE_URL"
echo "TOTAL=$total PASS=$pass_count FAIL=$fail_count"
echo "ARTIFACTS=$OUT_DIR"

[ "$fail_count" -eq 0 ]
