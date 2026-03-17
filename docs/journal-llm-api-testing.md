# Journal LLM API Testing

## Files
- Sample env settings: `.env-llm`
- Sample journals: `sample-data/journal-llm-samples.json`

## Append env settings

```bash
cat .env-llm >> .env
```

## Can this be tested via API call?

Yes. Use `POST /api/journal/preview`.

Important:
- This endpoint is auth-protected and expects an authenticated session cookie.
- It returns HTML (HTMX fragment), not JSON.

For no-auth local testing, use `POST /api/journal/preview-test`:
- Set `JOURNAL_LLM_TEST_PREVIEW_KEY` in `.env`
- Send header `x-journal-test-key: <that-key>`
- This endpoint returns JSON and does not require a session cookie

## Single sample test (selected model)

```bash
curl -sS 'http://localhost:3001/api/journal/preview' \
  -X POST \
  -H 'Cookie: neon-auth-session=<your-session-cookie>' \
  --data-urlencode 'journalId=' \
  --data-urlencode 'journalModel=openai/gpt-oss-20b' \
  --data-urlencode 'compareModels=false' \
  --data-urlencode $'text=goal: Keep first serve above 60%\npractice: date=2026-03-16; workedOn=Serve + return; withCoach=true; coachName=Coach Kim; notes=Short block\ndiet: Hydration and protein focus'
```

## Compare mode test

```bash
curl -sS 'http://localhost:3001/api/journal/preview' \
  -X POST \
  -H 'Cookie: neon-auth-session=<your-session-cookie>' \
  --data-urlencode 'journalId=' \
  --data-urlencode 'journalModel=openai/gpt-oss-20b' \
  --data-urlencode 'compareModels=true' \
  --data-urlencode $'text=goal: weekStart=2026-03-16; planText=Raise first serve percentage to 62%\npractice: date=2026-03-16; workedOn=Serve + return depth patterns; withCoach=true; coachName=Coach Kim; notes=Focused on toss consistency\nmatch: date=2026-03-17; opponent=Alex; score=6-4 4-6 10-8; notes=Stayed patient in long rallies\ndiet: date=2026-03-16; summary=Hydration 3L, chicken + rice, post-session shake\nexercise: date=2026-03-16; durationMin=35; exerciseType=Mobility; notes=Hip and shoulder mobility'
```

## Batch test all 10 sample notes

```bash
SESSION_COOKIE='neon-auth-session=<your-session-cookie>'
MODEL='openai/gpt-oss-20b'

jq -r '.[] | @base64' sample-data/journal-llm-samples.json | while read -r row; do
  obj="$(printf '%s' "$row" | base64 -d)"
  id="$(printf '%s' "$obj" | jq -r '.id')"
  title="$(printf '%s' "$obj" | jq -r '.title')"
  text="$(printf '%s' "$obj" | jq -r '.text')"

  echo "=== $id :: $title ==="

  curl -sS 'http://localhost:3001/api/journal/preview' \
    -X POST \
    -H "Cookie: $SESSION_COOKIE" \
    --data-urlencode 'journalId=' \
    --data-urlencode "journalModel=$MODEL" \
    --data-urlencode 'compareModels=true' \
    --data-urlencode "text=$text" \
    | rg -o "Model Compare|Confidence [0-9]+%|Error: [^<]+" || true

  echo
  sleep 0.5
done
```

## Run the sample batch script

```bash
SESSION_COOKIE='neon-auth-session=<your-session-cookie>' MODEL='openai/gpt-oss-20b' COMPARE_MODELS=true ./scripts/test-journal-llm-samples.sh
```

The script prints each sample input, output summary, and PASS/FAIL; raw HTML + metadata are saved under `.runtime/journal-llm-sample-results/`.

No-auth local mode:

```bash
TEST_KEY='local-journal-test-key' APP_URL='http://localhost:3003' MODEL='openai/gpt-oss-20b' COMPARE_MODELS=true ./scripts/test-journal-llm-samples.sh
```

In `TEST_KEY` mode the script calls `/api/journal/preview-test` and saves JSON output per sample.
