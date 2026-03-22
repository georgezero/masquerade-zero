#!/usr/bin/env node
/**
 * Compare two or more benchmark eval directories side-by-side.
 *
 * Usage:
 *   node scripts/compare-benchmark-evals.js <eval-dir-1> <eval-dir-2> [eval-dir-3 ...]
 *
 * Each argument is a path to a benchmark-results/journal-evals/<timestamp>/ directory.
 * Reads all score-results.json files within each, then produces:
 *   - Console table (stdout)
 *   - COMPARISON.md written to the first eval dir
 *
 * A run is identified by "model + promptVariant". Runs with the same key across
 * evals are compared directly; runs that only appear in one eval are listed as-is.
 */

import fs from "fs";
import path from "path";

const evalDirs = process.argv.slice(2);
if (evalDirs.length < 2) {
  console.error("Usage: compare-benchmark-evals.js <eval-dir-1> <eval-dir-2> [...]");
  process.exit(1);
}

for (const d of evalDirs) {
  if (!fs.existsSync(d)) { console.error(`Not found: ${d}`); process.exit(1); }
}

// --- load all runs from all eval dirs ---
function loadEval(evalDir) {
  const label = path.basename(evalDir);
  const runs = [];
  for (const entry of fs.readdirSync(evalDir)) {
    const f = path.join(evalDir, entry, "score-results.json");
    if (fs.existsSync(f)) {
      try {
        const data = JSON.parse(fs.readFileSync(f, "utf8"));
        runs.push({ ...data, _evalLabel: label, _evalDir: evalDir });
      } catch { console.warn(`Could not parse: ${f}`); }
    }
  }
  return { label, runs };
}

const evals = evalDirs.map(loadEval);
const evalLabels = evals.map((e) => e.label);

// Index: runKey (model::variant) -> evalLabel -> run data
const index = {};
for (const ev of evals) {
  for (const run of ev.runs) {
    const key = `${run.model}::${run.promptVariant}`;
    if (!index[key]) index[key] = {};
    index[key][ev.label] = run;
  }
}

const allKeys = Object.keys(index).sort();
const allKinds = [...new Set(
  evals.flatMap((e) => e.runs.flatMap((r) => Object.keys(r.byKind ?? {})))
)].sort();

function pct(v, d = 1) { return v == null ? "n/a" : `${(v * 100).toFixed(d)}%`; }
function num(v, d = 3) { return v == null ? "n/a" : Number(v).toFixed(d); }
function ms(v) { return v == null ? "n/a" : `${v}ms`; }
function delta(a, b, d = 3) {
  if (a == null || b == null) return "n/a";
  const diff = b - a;
  return `${diff >= 0 ? "+" : ""}${diff.toFixed(d)}`;
}
function deltaArrow(a, b, threshold = 0.01) {
  if (a == null || b == null) return "";
  const diff = b - a;
  if (diff > threshold) return " ↑";
  if (diff < -threshold) return " ↓";
  return " →";
}

const lines = [];

// --- header ---
lines.push(`# Benchmark Eval Comparison`);
lines.push(``);
lines.push(`Comparing ${evals.length} evals:`);
for (let i = 0; i < evals.length; i++) {
  lines.push(`- **[${i + 1}] ${evalLabels[i]}** — ${evals[i].runs.length} run(s)`);
}
lines.push(``);
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(``);

// --- overview table: one row per run-key, one column per eval ---
lines.push(`## Micro-F1 Overview`);
lines.push(``);

const headerCols = ["Model", "Variant", ...evalLabels.map((l, i) => `[${i+1}] F1`), ...evalLabels.map((l, i) => `[${i+1}] R`), ...evalLabels.map((l, i) => `[${i+1}] ms`)];
if (evals.length === 2) {
  headerCols.push("Δ F1", "Δ Recall", "Δ ms");
}
lines.push(`| ${headerCols.join(" | ")} |`);
lines.push(`| ${headerCols.map(() => "---").join(" | ")} |`);

for (const key of allKeys) {
  const [model, variant] = key.split("::");
  const vals = evalLabels.map((l) => index[key][l]?.summary ?? null);
  const f1s = vals.map((s) => s?.microF1 ?? null);
  const rs  = vals.map((s) => s?.microR ?? null);
  const mss = vals.map((s) => s?.avgDurationMs ?? null);

  const f1Cols = f1s.map((v) => {
    if (v == null) return "—";
    const best = Math.max(...f1s.filter((x) => x != null));
    return v === best && evals.length > 1 ? `**${num(v)}**` : num(v);
  });
  const rCols = rs.map((v) => v == null ? "—" : num(v));
  const msCols = mss.map((v) => v == null ? "—" : ms(v));

  const row = [`\`${model}\``, variant, ...f1Cols, ...rCols, ...msCols];
  if (evals.length === 2) {
    row.push(f1s[0] != null && f1s[1] != null ? `**${delta(f1s[0], f1s[1])}**${deltaArrow(f1s[0], f1s[1])}` : "—");
    row.push(rs[0] != null && rs[1] != null ? `${delta(rs[0], rs[1])}${deltaArrow(rs[0], rs[1])}` : "—");
    // ms delta: negative = faster on [2]
    const dms = mss[0] != null && mss[1] != null ? mss[1] - mss[0] : null;
    row.push(dms != null ? `${dms >= 0 ? "+" : ""}${dms}ms${dms > 500 ? " ↑slower" : dms < -500 ? " ↓faster" : ""}` : "—");
  }
  lines.push(`| ${row.join(" | ")} |`);
}
lines.push(``);

// --- full metrics table ---
lines.push(`## Full Metrics per Run`);
lines.push(``);
lines.push(`| Eval | Model | Variant | Micro-F1 | Macro-F1 | P | R | Pass% | Under-extr% | Avg ms |`);
lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
for (const ev of evals) {
  for (const run of ev.runs) {
    const s = run.summary;
    lines.push(`| ${ev.label} | \`${run.model}\` | ${run.promptVariant} | **${num(s.microF1)}** | ${num(s.macroF1)} | ${num(s.microP)} | ${num(s.microR)} | ${pct(s.passRate, 0)} | ${pct(s.underExtractionRate, 0)} | ${ms(s.avgDurationMs)} |`);
  }
}
lines.push(``);

// --- per-kind comparison (only for 2-eval comparisons with matching run keys) ---
if (evals.length === 2) {
  const sharedKeys = allKeys.filter((k) => index[k][evalLabels[0]] && index[k][evalLabels[1]]);
  if (sharedKeys.length > 0) {
    lines.push(`## Per-Kind Delta ([2] vs [1])`);
    lines.push(``);
    lines.push(`Positive = [2] is better.`);
    lines.push(``);
    lines.push(`| Model | Variant | Kind | [1] P/R/F1 | [2] P/R/F1 | Δ F1 |`);
    lines.push(`| --- | --- | --- | --- | --- | --- |`);
    for (const key of sharedKeys) {
      const [model, variant] = key.split("::");
      const r1 = index[key][evalLabels[0]];
      const r2 = index[key][evalLabels[1]];
      for (const kind of allKinds) {
        const k1 = r1.byKind?.[kind];
        const k2 = r2.byKind?.[kind];
        if (!k1 && !k2) continue;
        const f1_1 = k1?.f1 ?? null;
        const f1_2 = k2?.f1 ?? null;
        const prf1 = (k) => k ? `${num(k.p,2)}/${num(k.r,2)}/${num(k.f1,2)}` : "—";
        const df1 = delta(f1_1, f1_2, 3);
        const arrow = f1_1 != null && f1_2 != null ? deltaArrow(f1_1, f1_2) : "";
        lines.push(`| \`${model}\` | ${variant} | ${kind} | ${prf1(k1)} | ${prf1(k2)} | **${df1}**${arrow} |`);
      }
    }
    lines.push(``);
  }
}

// --- per-sample detail for shared run keys ---
if (evals.length === 2) {
  const sharedKeys = allKeys.filter((k) => index[k][evalLabels[0]] && index[k][evalLabels[1]]);
  if (sharedKeys.length > 0) {
    lines.push(`## Per-Sample Detail`);
    lines.push(``);
    for (const key of sharedKeys) {
      const [model, variant] = key.split("::");
      lines.push(`### \`${model}\` / ${variant}`);
      lines.push(``);
      lines.push(`| Sample | [1] actual | [1] F1 | [2] actual | [2] F1 | Δ F1 |`);
      lines.push(`| --- | --- | --- | --- | --- | --- |`);
      const r1 = index[key][evalLabels[0]];
      const r2 = index[key][evalLabels[1]];
      const allSampleIds = [...new Set([
        ...(r1.samples ?? []).map((s) => s.id),
        ...(r2.samples ?? []).map((s) => s.id),
      ])];
      for (const id of allSampleIds) {
        const s1 = r1.samples?.find((s) => s.id === id);
        const s2 = r2.samples?.find((s) => s.id === id);
        const act1 = s1?.status === "ok" ? (s1.actualKinds ?? []).join(",") : s1?.status ?? "—";
        const act2 = s2?.status === "ok" ? (s2.actualKinds ?? []).join(",") : s2?.status ?? "—";
        const f1_1 = s1?.status === "ok" ? s1.f1 : null;
        const f1_2 = s2?.status === "ok" ? s2.f1 : null;
        const df1 = delta(f1_1, f1_2, 2);
        const arrow = f1_1 != null && f1_2 != null ? deltaArrow(f1_1, f1_2, 0.05) : "";
        lines.push(`| ${id} | ${act1} | ${f1_1 != null ? num(f1_1, 2) : "—"} | ${act2} | ${f1_2 != null ? num(f1_2, 2) : "—"} | ${df1}${arrow} |`);
      }
      lines.push(``);
    }
  }
}

// --- console summary ---
console.log(`\nComparing: ${evalLabels.join("  vs  ")}`);
console.log(`${"─".repeat(80)}`);
console.log(`${"Run key".padEnd(40)} ${evalLabels.map((l) => l.slice(-8).padEnd(12)).join("")}`);
console.log(`${"─".repeat(80)}`);
for (const key of allKeys) {
  const [model, variant] = key.split("::");
  const label = `${model.split("/").pop()} / ${variant}`;
  const scores = evalLabels.map((l) => {
    const f1 = index[key][l]?.summary?.microF1;
    return f1 != null ? num(f1) : "  —  ";
  });
  console.log(`${label.padEnd(40)} ${scores.map((s) => s.padEnd(12)).join("")}`);
}
console.log(`${"─".repeat(80)}\n`);

// --- write COMPARISON.md to first eval dir ---
const outPath = path.join(evalDirs[0], "COMPARISON.md");
fs.writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`COMPARISON.md written to: ${outPath}`);
