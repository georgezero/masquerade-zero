#!/usr/bin/env bash
set -euo pipefail

APP_URL="${APP_URL:-https://tennis-zero-six-alpha-journal-llm.fff.ad}"
SESSION_COOKIE="${SESSION_COOKIE:-}"
TEST_KEY="${TEST_KEY:-}"
MODEL="${MODEL:-openai/gpt-oss-20b}"
COMPARE_MODELS="${COMPARE_MODELS:-true}"
SAMPLES_FILE="${SAMPLES_FILE:-sample-data/journal-llm-samples.json}"
OUT_DIR="${OUT_DIR:-.runtime/journal-llm-sample-results}"

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required." >&2
  exit 1
fi

if [ -z "$TEST_KEY" ] && [ -z "$SESSION_COOKIE" ]; then
  cat >&2 <<'MSG'
Error: provide either TEST_KEY or SESSION_COOKIE.
No-auth local testing (recommended):
  export TEST_KEY='<your JOURNAL_LLM_TEST_PREVIEW_KEY>'
Cookie testing:
  export SESSION_COOKIE='neon-auth-session=<value>'
or include additional cookies if needed, e.g.:
  export SESSION_COOKIE='neon-auth-session=<value>; another-cookie=<value>'
MSG
  exit 1
fi

if [ ! -f "$SAMPLES_FILE" ]; then
  echo "Error: samples file not found: $SAMPLES_FILE" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

pass_count=0
fail_count=0
index=0

while IFS= read -r row_b64; do
  index=$((index + 1))
  row_json="$(printf '%s' "$row_b64" | base64 -d)"
  id="$(printf '%s' "$row_json" | jq -r '.id')"
  title="$(printf '%s' "$row_json" | jq -r '.title')"
  text="$(printf '%s' "$row_json" | jq -r '.text')"

  out_html="$OUT_DIR/${index}-${id}.html"
  out_json="$OUT_DIR/${index}-${id}.json"
  out_meta="$OUT_DIR/${index}-${id}.meta.txt"

  echo "============================================================"
  echo "[$index] $id :: $title"
  echo "------------------------------------------------------------"
  echo "INPUT"
  echo "------------------------------------------------------------"
  printf '%s\n' "$text"
  echo

  curl_error=0
  if [ -n "$TEST_KEY" ]; then
    payload="$(jq -nc --arg t "$text" --arg m "$MODEL" --arg c "$COMPARE_MODELS" '{text:$t,journalModel:$m,compareModels:$c}')"
    if ! http_code="$(curl -sS "$APP_URL/api/journal/preview-test" \
      --retry 3 \
      --retry-all-errors \
      --retry-delay 1 \
      -o "$out_json" \
      -w '%{http_code}' \
      -X POST \
      -H "x-journal-test-key: $TEST_KEY" \
      -H 'Content-Type: application/json' \
      --data "$payload")"; then
      curl_error=1
      http_code="000"
      : > "$out_json"
    fi

    candidate_count="$(jq -r '(.candidates // []) | length' "$out_json" 2>/dev/null || echo 0)"
    validation_error_count="$(jq -r '(.errors // []) | length' "$out_json" 2>/dev/null || echo 0)"
    no_candidate_count=0
    if [ "$candidate_count" = "0" ] && [ "$validation_error_count" = "0" ] && [ "$http_code" = "200" ]; then
      no_candidate_count=1
    fi
    fallback_count="$(jq -r 'if .usedFallback == true then 1 else 0 end' "$out_json" 2>/dev/null || echo 0)"
    summary_lines="$(jq -r '[ (.compareResults // [])[] | ("model=" + .model + " durationMs=" + (.durationMs|tostring) + " candidates=" + (.candidateCount|tostring) + (if .error then " error=" + .error else "" end)) ] | .[]' "$out_json" 2>/dev/null || true)"
  else
    if ! http_code="$(curl -sS "$APP_URL/api/journal/preview" \
      --retry 3 \
      --retry-all-errors \
      --retry-delay 1 \
      -o "$out_html" \
      -w '%{http_code}' \
      -X POST \
      -H "Cookie: $SESSION_COOKIE" \
      --data-urlencode 'journalId=' \
      --data-urlencode "journalModel=$MODEL" \
      --data-urlencode "compareModels=$COMPARE_MODELS" \
      --data-urlencode "text=$text")"; then
      curl_error=1
      http_code="000"
      : > "$out_html"
    fi

    candidate_count="$( (rg -o 'id="journal-item-' "$out_html" || true) | wc -l | tr -d ' ' )"
    validation_error_count="$( (rg -o 'Some lines could not be parsed/validated' "$out_html" || true) | wc -l | tr -d ' ' )"
    no_candidate_count="$( (rg -o 'No candidate entries found' "$out_html" || true) | wc -l | tr -d ' ' )"
    fallback_count="$( (rg -o 'Deterministic parser fallback used' "$out_html" || true) | wc -l | tr -d ' ' )"
    summary_lines="$(rg -o 'Model Compare|Confidence [0-9]+%|Error: [^<]+' "$out_html" || true)"
  fi

  status="PASS"
  reason=""
  if [ "$curl_error" -ne 0 ]; then
    status="FAIL"
    reason="Network error"
  elif [ "$http_code" != "200" ]; then
    status="FAIL"
    reason="HTTP $http_code"
  elif [ "$no_candidate_count" -gt 0 ]; then
    status="FAIL"
    reason="No candidates"
  elif [ "$candidate_count" -eq 0 ]; then
    status="FAIL"
    reason="No candidate cards"
  fi

  if [ "$status" = "PASS" ]; then
    pass_count=$((pass_count + 1))
  else
    fail_count=$((fail_count + 1))
  fi

  {
    echo "id=$id"
    echo "title=$title"
    echo "http_code=$http_code"
    echo "status=$status"
    echo "reason=$reason"
    echo "curl_error=$curl_error"
    echo "candidate_count=$candidate_count"
    echo "validation_error_count=$validation_error_count"
    echo "fallback_count=$fallback_count"
  } > "$out_meta"

  echo "OUTPUT SUMMARY"
  echo "------------------------------------------------------------"
  echo "HTTP: $http_code"
  echo "Candidates: $candidate_count"
  echo "Validation error sections: $validation_error_count"
  echo "Fallback warnings: $fallback_count"
  if [ -n "$summary_lines" ]; then
    echo "$summary_lines"
  else
    echo "(No compare/confidence summary tokens found)"
  fi
  if [ "$status" = "PASS" ]; then
    echo "RESULT: PASS"
  else
    echo "RESULT: FAIL ($reason)"
  fi
  if [ -n "$TEST_KEY" ]; then
    echo "Saved JSON: $out_json"
  else
    echo "Saved HTML: $out_html"
  fi
  echo "Saved meta: $out_meta"
  echo

done < <(jq -r '.[] | @base64' "$SAMPLES_FILE")

echo "============================================================"
echo "DONE"
echo "Pass: $pass_count"
echo "Fail: $fail_count"
echo "Artifacts: $OUT_DIR"
if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
