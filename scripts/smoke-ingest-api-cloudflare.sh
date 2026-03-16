#!/usr/bin/env bash
set -euo pipefail

APP_URL="${APP_URL:-https://tennis-zero-six-alpha-ingest.fff.ad}"
INGEST_KEY="${INGEST_KEY:-}"
RUN_RATE_LIMIT_TEST="${RUN_RATE_LIMIT_TEST:-0}"

if [[ -z "$INGEST_KEY" ]]; then
  echo "INGEST_KEY is required."
  echo "Example: INGEST_KEY='tz6_ingest_...' $0"
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
    {"kind":"goal","fields":{"weekStart":"2026-03-16","planText":"cloudflare smoke test"}}
  ]
}'

PAYLOAD_200='{
  "mode":"structured",
  "userId":"smoke-user",
  "dryRun":true,
  "idempotencyKey":"cf-smoke-20260316-001",
  "items":[
    {"kind":"goal","fields":{"weekStart":"2026-03-16","planText":"cloudflare smoke test"}}
  ]
}'

PAYLOAD_409='{
  "mode":"structured",
  "userId":"smoke-user",
  "dryRun":true,
  "idempotencyKey":"cf-smoke-20260316-001",
  "items":[
    {"kind":"goal","fields":{"weekStart":"2026-03-16","planText":"different cloudflare payload"}}
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

if [[ "$RUN_RATE_LIMIT_TEST" == "1" ]]; then
  echo
  echo "Running optional rate-limit test (expect possible 429 only if server limit is low)..."
  for i in 1 2 3; do
    payload="{\"mode\":\"structured\",\"userId\":\"cf-rate-user\",\"dryRun\":true,\"items\":[{\"kind\":\"diet\",\"fields\":{\"date\":\"2026-03-16\",\"summary\":\"cf rate test $i\"}}]}"
    response="$("${CURL_BASE[@]}" -H "Authorization: Bearer $INGEST_KEY" -d "$payload")"
    status="$(printf '%s\n' "$response" | awk 'BEGIN{IGNORECASE=1} /^HTTP\// {code=$2} END{print code}')"
    echo "rate attempt $i -> $status"
  done
fi

echo
printf 'Cloudflare smoke tests passed against %s\n' "$APP_URL"
