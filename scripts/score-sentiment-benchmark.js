#!/usr/bin/env node
/**
 * Score sentiment benchmark results against expectedSentiment labels.
 *
 * Usage:
 *   node scripts/score-sentiment-benchmark.js <samples-file> <artifacts-dir> [options]
 *
 * Options:
 *   --model <name>    Model name for JSON output
 *   --variant <name>  Prompt variant for JSON output
 *   --output <file>   Write JSON results to this path
 *
 * Scoring:
 *   mood, intensity, format  →  exact-match accuracy (0 or 1 per sample)
 *   tags                     →  precision / recall / F1 over the tag set
 *   overall                  →  mean of mood_acc + intensity_acc + format_acc + tag_f1
 */

import fs from "fs";
import path from "path";

// --- arg parsing ---
const positional = [];
const opts = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--") && i + 1 < process.argv.length) {
    opts[process.argv[i].slice(2)] = process.argv[++i];
  } else {
    positional.push(process.argv[i]);
  }
}

const [samplesFile, artifactsDir] = positional;
const modelLabel   = opts.model   ?? "unknown";
const variantLabel = opts.variant ?? "unknown";
const outputFile   = opts.output  ?? null;

if (!samplesFile || !artifactsDir) {
  console.error("Usage: score-sentiment-benchmark.js <samples-file> <artifacts-dir> [--model X] [--variant X] [--output X]");
  process.exit(1);
}
if (!fs.existsSync(samplesFile))  { console.error(`Not found: ${samplesFile}`);  process.exit(1); }
if (!fs.existsSync(artifactsDir)) { console.error(`Not found: ${artifactsDir}`); process.exit(1); }

const samples      = JSON.parse(fs.readFileSync(samplesFile, "utf8"));
const artifactFiles = fs.readdirSync(artifactsDir);

const VALID_MOODS      = new Set(["positive", "neutral", "negative"]);
const VALID_INTENSITIES = new Set(["high", "medium", "low"]);
const VALID_FORMATS    = new Set(["formal", "informal"]);
const VALID_TAGS       = new Set(["tactical","physical","mental","coach","match-play","recovery","nutrition","social","breakthrough","struggle","fun"]);

function findArtifact(index, id, ext) {
  const exact = `${index}-${id}.${ext}`;
  if (artifactFiles.includes(exact)) return path.join(artifactsDir, exact);
  const fallback = artifactFiles.find((f) => f.endsWith(`-${id}.${ext}`));
  return fallback ? path.join(artifactsDir, fallback) : null;
}

function readMeta(index, id) {
  const f = findArtifact(index, id, "meta.txt");
  if (!f) return {};
  const out = {};
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq >= 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function tagF1(expectedTags, actualTags) {
  const exp = new Set(expectedTags);
  const act = new Set(actualTags);
  const tp = [...exp].filter((t) => act.has(t)).length;
  const fp = [...act].filter((t) => !exp.has(t)).length;
  const fn = [...exp].filter((t) => !act.has(t)).length;
  const p  = tp + fp === 0 ? 0 : tp / (tp + fp);
  const r  = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = p + r === 0 ? 0 : 2 * p * r / (p + r);
  return { tp, fp, fn, p, r, f1 };
}

function num(v, d = 2) { return v == null ? "n/a" : Number(v).toFixed(d); }

// per-dimension tag aggregates
const dimAgg = { mood: { correct: 0, total: 0 }, intensity: { correct: 0, total: 0 }, format: { correct: 0, total: 0 } };
const tagAgg = { tp: 0, fp: 0, fn: 0 };
const sampleResults = [];
let totalDurationMs = 0, durationCount = 0;
let passCount = 0, failCount = 0;

for (let i = 0; i < samples.length; i++) {
  const sample = samples[i];
  const { id, expectedSentiment } = sample;

  if (!expectedSentiment) {
    sampleResults.push({ id, status: "no-labels" });
    continue;
  }

  const meta       = readMeta(i + 1, id);
  const durationMs = meta.duration_ms ? parseInt(meta.duration_ms, 10) : null;
  const sampleStatus = meta.status ?? "unknown";
  if (sampleStatus === "PASS") passCount++; else failCount++;
  if (durationMs != null && !isNaN(durationMs)) { totalDurationMs += durationMs; durationCount++; }

  const cleanFile = findArtifact(i + 1, id, "clean.txt");
  if (!cleanFile) {
    sampleResults.push({ id, status: "missing", durationMs, sampleStatus });
    tagAgg.fn += (expectedSentiment.tags ?? []).length;
    for (const dim of ["mood", "intensity", "format"]) dimAgg[dim].total++;
    continue;
  }

  let actual = null;
  try {
    const raw = fs.readFileSync(cleanFile, "utf8").trim();
    actual = JSON.parse(raw);
    // handle array-wrapped response (some models wrap in [])
    if (Array.isArray(actual)) actual = actual[0];
  } catch {
    sampleResults.push({ id, status: "parse-error", durationMs, sampleStatus });
    tagAgg.fn += (expectedSentiment.tags ?? []).length;
    for (const dim of ["mood", "intensity", "format"]) dimAgg[dim].total++;
    continue;
  }

  const expMood      = expectedSentiment.mood;
  const expIntensity = expectedSentiment.intensity;
  const expFormat    = expectedSentiment.format;
  const expTags      = expectedSentiment.tags ?? [];

  const actMood      = typeof actual?.mood === "string"      ? actual.mood.toLowerCase().trim()      : null;
  const actIntensity = typeof actual?.intensity === "string" ? actual.intensity.toLowerCase().trim() : null;
  const actFormat    = typeof actual?.format === "string"    ? actual.format.toLowerCase().trim()    : null;
  const actTagsRaw   = Array.isArray(actual?.tags) ? actual.tags : [];
  const actTags      = actTagsRaw
    .map((t) => typeof t === "string" ? t.toLowerCase().trim() : "")
    .filter((t) => VALID_TAGS.has(t));

  const moodOk      = VALID_MOODS.has(actMood)      && actMood === expMood;
  const intensityOk = VALID_INTENSITIES.has(actIntensity) && actIntensity === expIntensity;
  const formatOk    = VALID_FORMATS.has(actFormat)  && actFormat === expFormat;
  const tags        = tagF1(expTags, actTags);

  dimAgg.mood.correct      += moodOk ? 1 : 0;      dimAgg.mood.total++;
  dimAgg.intensity.correct += intensityOk ? 1 : 0; dimAgg.intensity.total++;
  dimAgg.format.correct    += formatOk ? 1 : 0;    dimAgg.format.total++;
  tagAgg.tp += tags.tp; tagAgg.fp += tags.fp; tagAgg.fn += tags.fn;

  const sampleOverall = ((moodOk ? 1 : 0) + (intensityOk ? 1 : 0) + (formatOk ? 1 : 0) + tags.f1) / 4;

  sampleResults.push({
    id, status: "ok", durationMs, sampleStatus,
    expected: { mood: expMood, intensity: expIntensity, format: expFormat, tags: expTags },
    actual:   { mood: actMood, intensity: actIntensity, format: actFormat, tags: actTags },
    moodOk, intensityOk, formatOk,
    tags,
    overall: sampleOverall,
  });
}

// --- aggregate ---
const moodAcc      = dimAgg.mood.total      === 0 ? 0 : dimAgg.mood.correct      / dimAgg.mood.total;
const intensityAcc = dimAgg.intensity.total === 0 ? 0 : dimAgg.intensity.correct / dimAgg.intensity.total;
const formatAcc    = dimAgg.format.total    === 0 ? 0 : dimAgg.format.correct    / dimAgg.format.total;
const tagP         = tagAgg.tp + tagAgg.fp  === 0 ? 0 : tagAgg.tp / (tagAgg.tp + tagAgg.fp);
const tagR         = tagAgg.tp + tagAgg.fn  === 0 ? 0 : tagAgg.tp / (tagAgg.tp + tagAgg.fn);
const tagF1Agg     = tagP + tagR === 0 ? 0 : 2 * tagP * tagR / (tagP + tagR);
const overall      = (moodAcc + intensityAcc + formatAcc + tagF1Agg) / 4;
const avgDurationMs = durationCount === 0 ? null : Math.round(totalDurationMs / durationCount);
const passRate      = samples.length === 0 ? 0 : passCount / samples.length;

// --- console table ---
const PAD = 20;
console.log(`\n====  SENTIMENT BENCHMARK SCORE  ====`);
console.log(`model: ${modelLabel}  variant: ${variantLabel}`);
console.log(
  "id".padEnd(PAD) +
  "mood".padEnd(10) + "inten".padEnd(10) + "format".padEnd(10) +
  "tags P/R/F1".padEnd(20) + "overall".padEnd(9) + "ms"
);
console.log("-".repeat(90));
for (const r of sampleResults) {
  if (r.status !== "ok") { console.log(`${r.id.padEnd(PAD)} ${r.status}`); continue; }
  const moodStr   = `${r.moodOk   ? "✓" : "✗"} ${r.actual.mood ?? "?"}`;
  const intenStr  = `${r.intensityOk ? "✓" : "✗"} ${r.actual.intensity ?? "?"}`;
  const fmtStr    = `${r.formatOk ? "✓" : "✗"} ${r.actual.format ?? "?"}`;
  const tagsStr   = `${num(r.tags.p)}/${num(r.tags.r)}/${num(r.tags.f1)}`;
  console.log(
    r.id.padEnd(PAD) +
    moodStr.padEnd(10) + intenStr.padEnd(10) + fmtStr.padEnd(10) +
    tagsStr.padEnd(20) + num(r.overall).padEnd(9) + (r.durationMs ?? "-")
  );
}
console.log("-".repeat(90));
console.log(
  "AGGREGATE".padEnd(PAD) +
  `${num(moodAcc)}`.padEnd(10) + `${num(intensityAcc)}`.padEnd(10) + `${num(formatAcc)}`.padEnd(10) +
  `${num(tagP)}/${num(tagR)}/${num(tagF1Agg)}`.padEnd(20) + `${num(overall)}`
);
console.log(`pass-rate: ${(passRate*100).toFixed(0)}%  avg-ms: ${avgDurationMs ?? "n/a"}`);
console.log(`mood-acc: ${num(moodAcc)}  intensity-acc: ${num(intensityAcc)}  format-acc: ${num(formatAcc)}  tag-F1: ${num(tagF1Agg)}  overall: ${num(overall)}`);
console.log(`=====================================\n`);

// --- JSON output ---
if (outputFile) {
  const result = {
    model: modelLabel,
    promptVariant: variantLabel,
    scoredAt: new Date().toISOString(),
    summary: {
      overall:       +overall.toFixed(4),
      moodAcc:       +moodAcc.toFixed(4),
      intensityAcc:  +intensityAcc.toFixed(4),
      formatAcc:     +formatAcc.toFixed(4),
      tagP:          +tagP.toFixed(4),
      tagR:          +tagR.toFixed(4),
      tagF1:         +tagF1Agg.toFixed(4),
      passRate:      +passRate.toFixed(4),
      totalSamples:  samples.length,
      passCount, failCount,
      avgDurationMs,
      tagTp: tagAgg.tp, tagFp: tagAgg.fp, tagFn: tagAgg.fn,
    },
    samples: sampleResults,
  };
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  console.log(`JSON results written to: ${outputFile}`);
}
