#!/usr/bin/env bash
set -euo pipefail

APP_URL="${APP_URL:-https://tennis-zero-six-alpha-ingest.fff.ad}"
INGEST_KEY="${INGEST_KEY:-}"

if [[ -z "$INGEST_KEY" ]]; then
  echo "INGEST_KEY is required."
  echo "Example: export INGEST_KEY='tz6_ingest_dev_...'; $0"
  exit 1
fi

CURL_BASE=(curl -sS -i -X POST "$APP_URL/api/ingest" -H "Content-Type: application/json")

run_test() {
  local name="$1"
  local expected="$2"
  local payload="$3"
  shift 3
  local extra_headers=("$@")

  echo
  echo "=== $name (expect $expected) ==="
  local response
  response="$("${CURL_BASE[@]}" "${extra_headers[@]}" -d "$payload")"

  local status
  status="$(printf '%s\n' "$response" | awk 'BEGIN{IGNORECASE=1} /^HTTP\// {code=$2} END{print code}')"

  echo "$response" | sed -n '1,20p'
  if [[ "$status" != "$expected" ]]; then
    echo "FAIL: expected status $expected, got $status"
    exit 1
  fi
  echo "PASS: status $status"
}

PAYLOAD_401='{
  "mode":"structured",
  "userId":"smoke-user",
  "dryRun":true,
  "items":[
    {"kind":"goal","fields":{"weekStart":"2026-03-16","planText":"smoke test goal"}}
  ]
}'

PAYLOAD_200='{
  "mode":"structured",
  "userId":"smoke-user",
  "dryRun":true,
  "idempotencyKey":"smoke-20260316-001",
  "items":[
    {"kind":"goal","fields":{"weekStart":"2026-03-16","planText":"smoke test goal"}}
  ]
}'

PAYLOAD_409='{
  "mode":"structured",
  "userId":"smoke-user",
  "dryRun":true,
  "idempotencyKey":"smoke-20260316-001",
  "items":[
    {"kind":"goal","fields":{"weekStart":"2026-03-16","planText":"different payload"}}
  ]
}'

PAYLOAD_501='{
  "mode":"freeform",
  "userId":"smoke-user",
  "text":"Played 90 minutes and worked on serve + return."
}'

run_test "Missing key" "401" "$PAYLOAD_401"
run_test "Valid key dryRun" "200" "$PAYLOAD_200" -H "Authorization: Bearer $INGEST_KEY"
run_test "Idempotency conflict" "409" "$PAYLOAD_409" -H "Authorization: Bearer $INGEST_KEY"
run_test "Freeform placeholder" "501" "$PAYLOAD_501" -H "Authorization: Bearer $INGEST_KEY"

echo
read -r -p "Run optional rate-limit loop now? (y/N): " RUN_RATE
if [[ "$RUN_RATE" =~ ^[Yy]$ ]]; then
  for i in 1 2 3; do
    payload="{\"mode\":\"structured\",\"userId\":\"rate-user\",\"dryRun\":true,\"items\":[{\"kind\":\"diet\",\"fields\":{\"date\":\"2026-03-16\",\"summary\":\"rate test $i\"}}]}"
    run_test "Rate limit attempt $i" "200" "$payload" -H "Authorization: Bearer $INGEST_KEY" || true
  done
  echo "Note: You may not see 429 unless INGEST_RATE_LIMIT_MAX is set low."
fi

echo
printf 'All required smoke tests passed against %s\n' "$APP_URL"
