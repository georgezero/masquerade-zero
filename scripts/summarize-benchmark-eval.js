#!/usr/bin/env node
/**
 * Generate SUMMARY.md from a benchmark eval directory.
 * Usage: node scripts/summarize-benchmark-eval.js <eval-dir>
 * Reads all score-results.json files found in subdirectories.
 */
import fs from "fs";
import path from "path";

const evalDir = process.argv[2];
if (!evalDir || !fs.existsSync(evalDir)) {
  console.error(`Usage: summarize-benchmark-eval.js <eval-dir>`);
  process.exit(1);
}

// Collect all score-results.json files
const runs = [];
for (const entry of fs.readdirSync(evalDir)) {
  const scoreFile = path.join(evalDir, entry, "score-results.json");
  if (fs.existsSync(scoreFile)) {
    try {
      runs.push(JSON.parse(fs.readFileSync(scoreFile, "utf8")));
    } catch {
      console.warn(`Could not parse: ${scoreFile}`);
    }
  }
}

if (runs.length === 0) {
  console.error("No score-results.json files found.");
  process.exit(1);
}

// Sort: model asc, variant asc
runs.sort((a, b) => {
  const m = a.model.localeCompare(b.model);
  return m !== 0 ? m : a.promptVariant.localeCompare(b.promptVariant);
});

function pct(v) { return `${(v * 100).toFixed(1)}%`; }
function num(v, d = 3) { return v == null ? "n/a" : v.toFixed(d); }
function ms(v) { return v == null ? "n/a" : `${v}ms`; }

// Build markdown
const lines = [];
const ts = path.basename(evalDir);
lines.push(`# Journal LLM Benchmark Eval — ${ts}`);
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(`Samples: 10 prose-no-dates  |  Runs: ${runs.length}`);
lines.push(``);

// Main results table
lines.push(`## Results Overview`);
lines.push(``);
lines.push(`| Model | Variant | Micro-F1 | Macro-F1 | Precision | Recall | Pass% | Under-extr% | Avg latency |`);
lines.push(`|-------|---------|----------|----------|-----------|--------|-------|-------------|-------------|`);
for (const r of runs) {
  const s = r.summary;
  lines.push(
    `| \`${r.model}\` | ${r.promptVariant} | **${num(s.microF1)}** | ${num(s.macroF1)} | ${num(s.microP)} | ${num(s.microR)} | ${pct(s.passRate)} | ${pct(s.underExtractionRate)} | ${ms(s.avgDurationMs)} |`
  );
}
lines.push(``);

// Delta table: compact vs standard per model
lines.push(`## Compact vs Standard Delta`);
lines.push(``);
lines.push(`Positive = compact is better. Based on micro-F1.`);
lines.push(``);
lines.push(`| Model | Micro-F1 std | Micro-F1 cpt | Δ F1 | Recall std | Recall cpt | Δ Recall | Under-extr std | Under-extr cpt |`);
lines.push(`|-------|-------------|-------------|------|-----------|-----------|---------|---------------|--------------|`);

const byModel = {};
for (const r of runs) {
  if (!byModel[r.model]) byModel[r.model] = {};
  byModel[r.model][r.promptVariant] = r;
}
for (const [model, variants] of Object.entries(byModel)) {
  const std = variants.standard;
  const cpt = variants.compact;
  if (!std || !cpt) continue;
  const df1 = cpt.summary.microF1 - std.summary.microF1;
  const dr = cpt.summary.microR - std.summary.microR;
  lines.push(
    `| \`${model}\` | ${num(std.summary.microF1)} | ${num(cpt.summary.microF1)} | **${df1 >= 0 ? "+" : ""}${num(df1)}** | ${num(std.summary.microR)} | ${num(cpt.summary.microR)} | ${dr >= 0 ? "+" : ""}${num(dr)} | ${pct(std.summary.underExtractionRate)} | ${pct(cpt.summary.underExtractionRate)} |`
  );
}
lines.push(``);

// Per-kind breakdown for each run
lines.push(`## Per-Kind Precision / Recall / F1`);
lines.push(``);
const allKinds = [...new Set(runs.flatMap((r) => Object.keys(r.byKind ?? {})))].sort();
lines.push(`| Model | Variant | Kind | TP | FP | FN | P | R | F1 |`);
lines.push(`|-------|---------|------|----|----|----|----|---|-----|`);
for (const r of runs) {
  for (const kind of allKinds) {
    const k = r.byKind?.[kind];
    if (!k) continue;
    lines.push(`| \`${r.model}\` | ${r.promptVariant} | ${kind} | ${k.tp} | ${k.fp} | ${k.fn} | ${num(k.p, 2)} | ${num(k.r, 2)} | ${num(k.f1, 2)} |`);
  }
}
lines.push(``);

// Per-sample detail for each run
lines.push(`## Per-Sample Detail`);
lines.push(``);
for (const r of runs) {
  lines.push(`### ${r.model} / ${r.promptVariant}`);
  lines.push(``);
  lines.push(`| Sample | Expected | Actual | TP | FP | FN | F1 | ms |`);
  lines.push(`|--------|----------|--------|----|----|----|----|-----|`);
  for (const s of r.samples ?? []) {
    if (s.status !== "ok") {
      lines.push(`| ${s.id} | — | — | — | — | — | *${s.status}* | — |`);
      continue;
    }
    lines.push(
      `| ${s.id} | ${(s.expectedKinds ?? []).join(",")} | ${(s.actualKinds ?? []).join(",")} | ${s.tp} | ${s.fp} | ${s.fn} | ${num(s.f1, 2)} | ${s.durationMs ?? "-"} |`
    );
  }
  lines.push(``);
}

// Key findings
lines.push(`## Key Findings`);
lines.push(``);

const smallModels = ["liquid/lfm2.5-1.2b", "gemma-3-1b-it-qat"];
for (const model of smallModels) {
  const variants = byModel[model];
  if (!variants?.standard || !variants?.compact) continue;
  const dr = variants.compact.summary.microR - variants.standard.summary.microR;
  const df1 = variants.compact.summary.microF1 - variants.standard.summary.microF1;
  const arrow = df1 > 0.02 ? "↑ improved" : df1 < -0.02 ? "↓ regressed" : "→ neutral";
  lines.push(`- **${model}** compact vs standard: F1 ${arrow} (Δ=${df1 >= 0 ? "+" : ""}${num(df1)}), recall Δ=${dr >= 0 ? "+" : ""}${num(dr)}`);
}

const bigModel = byModel["openai/gpt-oss-20b"];
if (bigModel?.standard && bigModel?.compact) {
  const df1 = bigModel.compact.summary.microF1 - bigModel.standard.summary.microF1;
  lines.push(`- **openai/gpt-oss-20b** compact vs standard: F1 Δ=${df1 >= 0 ? "+" : ""}${num(df1)} (expected ~neutral)`);
}

lines.push(``);
lines.push(`---`);
lines.push(`*Generated by scripts/summarize-benchmark-eval.js*`);

const summaryPath = path.join(evalDir, "SUMMARY.md");
fs.writeFileSync(summaryPath, lines.join("\n") + "\n");
console.log(`Written: ${summaryPath}`);
