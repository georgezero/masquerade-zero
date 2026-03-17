# Qwen 3.5 9B Prose Benchmark (`/no_think` vs default)

Date: March 17, 2026  
Dataset: `sample-data/journal-llm-samples-prose.json` (10 prose samples)  
Endpoint: `POST /api/journal/preview-test` (local no-auth test key mode)

## Results

1. `openai/gpt-oss-20b` (reference, updated prompt)
- Pass: `10/10`
- Fallback usage: `0/10`
- Runtime: `32s` total

2. `qwen/qwen3.5-9b` (default reasoning behavior)
- Pass: `0/10`
- Fallback usage: `10/10`
- Runtime: `378s` total

3. `qwen/qwen3.5-9b` with `/no_think` prefix
- Pass: `0/10`
- Fallback usage: `10/10`
- Runtime: `377s` total

## Comparison

1. `/no_think` did not materially improve `qwen/qwen3.5-9b` performance in this setup.
2. `openai/gpt-oss-20b` remained both the most reliable and the fastest model on the prose benchmark.
3. `qwen/qwen3.5-9b` was about `~11.8x` slower than `openai/gpt-oss-20b` on the same dataset.

## Runtime artifact locations

- OpenAI prose run: `.runtime/journal-llm-prose-openai-v2prompt/`
- Qwen prose run: `.runtime/journal-llm-prose-qwen9b/`
- Qwen prose `/no_think` run: `.runtime/journal-llm-prose-qwen9b-no-think/`

