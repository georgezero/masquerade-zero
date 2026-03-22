#!/usr/bin/env node
/**
 * Score journal LLM benchmark results against expected labels.
 *
 * Usage:
 *   node scripts/score-journal-benchmark.js <samples-file> <artifacts-dir> [options]
 *
 * Options:
 *   --model <name>      Model name to embed in JSON output
 *   --variant <name>    Prompt variant to embed in JSON output
 *   --output <file>     Write full JSON results to this path
 *
 * Computes precision / recall / F1 on (kind, date) pair matches.
 * A pair matches when: kind is equal AND (expected date is null OR dates match exactly).
 * For the prose-no-dates sample set all expected dates are null, so matching is kind-only.
 */

import fs from "fs";
import path from "path";

// --- arg parsing ---
const positional = [];
const opts = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--") && i + 1 < argv.length) {
    opts[argv[i].slice(2)] = argv[++i];
  } else {
    positional.push(argv[i]);
  }
}

const [samplesFile, artifactsDir] = positional;
const modelLabel = opts.model ?? "unknown";
const variantLabel = opts.variant ?? "unknown";
const outputFile = opts.output ?? null;

if (!samplesFile || !artifactsDir) {
  console.error("Usage: score-journal-benchmark.js <samples-file> <artifacts-dir> [--model <name>] [--variant <name>] [--output <file>]");
  process.exit(1);
}

if (!fs.existsSync(samplesFile)) { console.error(`Samples file not found: ${samplesFile}`); process.exit(1); }
if (!fs.existsSync(artifactsDir)) { console.error(`Artifacts directory not found: ${artifactsDir}`); process.exit(1); }

const samples = JSON.parse(fs.readFileSync(samplesFile, "utf8"));
const artifactFiles = fs.readdirSync(artifactsDir);

function findArtifact(index, id, ext) {
  const exact = `${index}-${id}.${ext}`;
  if (artifactFiles.includes(exact)) return path.join(artifactsDir, exact);
  const fallback = artifactFiles.find((f) => f.endsWith(`-${id}.${ext}`));
  return fallback ? path.join(artifactsDir, fallback) : null;
}

function readMeta(index, id) {
  const f = findArtifact(index, id, "meta.txt");
  if (!f) return {};
  const text = fs.readFileSync(f, "utf8");
  const result = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return result;
}

function pairsFromActual(candidates) {
  return candidates.map((c) => ({
    kind: (c.kind ?? "").toLowerCase(),
    date: c.fields?.date ?? c.fields?.weekStart ?? null,
  }));
}

function matchPairs(expected, actual) {
  const pool = [...actual];
  let tp = 0;
  for (const exp of expected) {
    const idx = pool.findIndex(
      (act) => act.kind === exp.kind && (exp.date === null || act.date === exp.date)
    );
    if (idx !== -1) { tp++; pool.splice(idx, 1); }
  }
  return { tp, fp: actual.length - tp, fn: expected.length - tp };
}

function f1(p, r) { return p + r === 0 ? 0 : (2 * p * r) / (p + r); }

const sampleResults = [];
const kindAgg = {}; // kind -> {tp, fp, fn}
let totalTp = 0, totalFp = 0, totalFn = 0;
let totalDurationMs = 0, durationCount = 0;
let underExtracted = 0; // samples where actual < expected count (pass samples only)
let passCount = 0, failCount = 0;

for (let i = 0; i < samples.length; i++) {
  const sample = samples[i];
  const { id, expected } = sample;

  if (!expected || !Array.isArray(expected)) {
    sampleResults.push({ id, status: "no-labels" });
    continue;
  }

  const meta = readMeta(i + 1, id);
  const durationMs = meta.duration_ms ? parseInt(meta.duration_ms, 10) : null;
  const sampleStatus = meta.status ?? "unknown";
  const sampleCandidates = meta.candidates ? parseInt(meta.candidates, 10) : null;

  if (sampleStatus === "PASS") passCount++;
  else failCount++;

  if (durationMs != null && !isNaN(durationMs)) {
    totalDurationMs += durationMs;
    durationCount++;
  }

  const cleanFile = findArtifact(i + 1, id, "clean.txt");
  if (!cleanFile) {
    const fn = expected.length;
    totalFn += fn;
    for (const e of expected) {
      if (!kindAgg[e.kind]) kindAgg[e.kind] = { tp: 0, fp: 0, fn: 0 };
      kindAgg[e.kind].fn++;
    }
    sampleResults.push({ id, status: "missing", tp: 0, fp: 0, fn, p: 0, r: 0, f1: 0, durationMs, sampleStatus, candidates: sampleCandidates });
    continue;
  }

  let actual = [];
  try {
    const raw = fs.readFileSync(cleanFile, "utf8").trim();
    const parsed = JSON.parse(raw);
    actual = Array.isArray(parsed) ? pairsFromActual(parsed) : [];
  } catch {
    const fn = expected.length;
    totalFn += fn;
    sampleResults.push({ id, status: "parse-error", tp: 0, fp: 0, fn, p: 0, r: 0, f1: 0, durationMs, sampleStatus, candidates: sampleCandidates });
    continue;
  }

  const { tp, fp, fn } = matchPairs(expected, actual);

  // per-kind accounting
  const expectedPool = [...expected];
  const actualPool = [...actual];
  const matchedExpected = new Set();
  const matchedActual = new Set();
  for (let ei = 0; ei < expectedPool.length; ei++) {
    const exp = expectedPool[ei];
    for (let ai = 0; ai < actualPool.length; ai++) {
      if (matchedActual.has(ai)) continue;
      const act = actualPool[ai];
      if (act.kind === exp.kind && (exp.date === null || act.date === exp.date)) {
        matchedExpected.add(ei);
        matchedActual.add(ai);
        if (!kindAgg[exp.kind]) kindAgg[exp.kind] = { tp: 0, fp: 0, fn: 0 };
        kindAgg[exp.kind].tp++;
        break;
      }
    }
  }
  for (let ei = 0; ei < expectedPool.length; ei++) {
    if (!matchedExpected.has(ei)) {
      const k = expectedPool[ei].kind;
      if (!kindAgg[k]) kindAgg[k] = { tp: 0, fp: 0, fn: 0 };
      kindAgg[k].fn++;
    }
  }
  for (let ai = 0; ai < actualPool.length; ai++) {
    if (!matchedActual.has(ai)) {
      const k = actualPool[ai].kind;
      if (!kindAgg[k]) kindAgg[k] = { tp: 0, fp: 0, fn: 0 };
      kindAgg[k].fp++;
    }
  }

  totalTp += tp; totalFp += fp; totalFn += fn;

  const p = tp + fp === 0 ? 0 : tp / (tp + fp);
  const r = tp + fn === 0 ? 0 : tp / (tp + fn);
  const sampleF1 = f1(p, r);

  // under-extraction: passed but fewer entries than expected
  if (sampleStatus === "PASS" && actual.length < expected.length) underExtracted++;

  sampleResults.push({
    id,
    status: "ok",
    tp, fp, fn, p, r, f1: sampleF1,
    durationMs,
    sampleStatus,
    candidates: sampleCandidates,
    expectedKinds: expected.map((e) => e.kind),
    actualKinds: actual.map((a) => a.kind),
  });
}

// --- aggregate metrics ---
const microP = totalTp + totalFp === 0 ? 0 : totalTp / (totalTp + totalFp);
const microR = totalTp + totalFn === 0 ? 0 : totalTp / (totalTp + totalFn);
const microF1 = f1(microP, microR);
const okRows = sampleResults.filter((r) => r.status === "ok");
const macroF1 = okRows.length === 0 ? 0 : okRows.reduce((s, r) => s + r.f1, 0) / okRows.length;
const avgDurationMs = durationCount === 0 ? null : Math.round(totalDurationMs / durationCount);
const passRate = samples.length === 0 ? 0 : passCount / samples.length;
const underExtractionRate = passCount === 0 ? 0 : underExtracted / passCount;

// per-kind metrics
const byKind = {};
for (const [kind, agg] of Object.entries(kindAgg)) {
  const kp = agg.tp + agg.fp === 0 ? 0 : agg.tp / (agg.tp + agg.fp);
  const kr = agg.tp + agg.fn === 0 ? 0 : agg.tp / (agg.tp + agg.fn);
  byKind[kind] = { ...agg, p: +kp.toFixed(4), r: +kr.toFixed(4), f1: +f1(kp, kr).toFixed(4) };
}

// --- console output ---
const PAD = 22;
console.log("\n====  JOURNAL BENCHMARK SCORE  ====");
console.log(`model: ${modelLabel}  variant: ${variantLabel}`);
console.log(
  "id".padEnd(PAD) + "expKinds".padEnd(24) + "actKinds".padEnd(24) +
  "TP".padEnd(4) + "FP".padEnd(4) + "FN".padEnd(4) +
  "P".padEnd(6) + "R".padEnd(6) + "F1".padEnd(6) + "ms"
);
console.log("-".repeat(100));
for (const r of sampleResults) {
  if (r.status !== "ok") { console.log(r.id.padEnd(PAD) + r.status); continue; }
  const expStr = r.expectedKinds.join(",");
  const actStr = r.actualKinds.join(",");
  console.log(
    r.id.padEnd(PAD) +
    expStr.padEnd(24).slice(0, 23).padEnd(24) +
    actStr.padEnd(24).slice(0, 23).padEnd(24) +
    String(r.tp).padEnd(4) + String(r.fp).padEnd(4) + String(r.fn).padEnd(4) +
    r.p.toFixed(2).padEnd(6) + r.r.toFixed(2).padEnd(6) + r.f1.toFixed(2).padEnd(6) +
    (r.durationMs ?? "-")
  );
}
console.log("-".repeat(100));
console.log(
  "MICRO-AVG".padEnd(PAD + 48) +
  String(totalTp).padEnd(4) + String(totalFp).padEnd(4) + String(totalFn).padEnd(4) +
  microP.toFixed(2).padEnd(6) + microR.toFixed(2).padEnd(6) + microF1.toFixed(2)
);
console.log(`MACRO-F1: ${macroF1.toFixed(3)}  pass-rate: ${(passRate*100).toFixed(0)}%  under-extraction: ${(underExtractionRate*100).toFixed(0)}%  avg-ms: ${avgDurationMs ?? "n/a"}`);
console.log("by-kind P/R/F1:");
for (const [kind, k] of Object.entries(byKind)) {
  console.log(`  ${kind.padEnd(10)} TP=${k.tp} FP=${k.fp} FN=${k.fn}  P=${k.p.toFixed(2)} R=${k.r.toFixed(2)} F1=${k.f1.toFixed(2)}`);
}
console.log("====================================\n");

// --- JSON output ---
if (outputFile) {
  const result = {
    model: modelLabel,
    promptVariant: variantLabel,
    scoredAt: new Date().toISOString(),
    summary: {
      microP: +microP.toFixed(4),
      microR: +microR.toFixed(4),
      microF1: +microF1.toFixed(4),
      macroF1: +macroF1.toFixed(4),
      passRate: +passRate.toFixed(4),
      underExtractionRate: +underExtractionRate.toFixed(4),
      totalSamples: samples.length,
      passCount,
      failCount,
      underExtractedCount: underExtracted,
      totalTp,
      totalFp,
      totalFn,
      avgDurationMs,
    },
    byKind,
    samples: sampleResults,
  };
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  console.log(`JSON results written to: ${outputFile}`);
}
