import OpenAI from "openai";
import { z } from "zod";

import { env, journalLlmBaseUrl, journalLlmEnabled } from "../env.js";
import { INGEST_KINDS, type StructuredIngestInput } from "./types.js";

const llmCandidateSchema = z
  .object({
    confidence: z.number().min(0).max(1).optional(),
    fields: z.record(z.unknown()),
    kind: z.enum(INGEST_KINDS),
    sourceSpan: z.string().trim().min(1).optional(),
    warnings: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const llmResponseSchema = z.array(llmCandidateSchema);
const INGEST_KIND_SET = new Set<string>(INGEST_KINDS);

const llmPassOneSchema = z.union([
  z.array(z.record(z.unknown())),
  z.object({
    candidates: z.array(z.record(z.unknown())),
  }).strict(),
]);

type OpenAiChatClient = {
  chat: {
    completions: {
      create: (params: {
        messages: Array<{ content: string; role: "system" | "user" }>;
        model: string;
        temperature: number;
      }) => Promise<{ choices?: Array<{ message?: { content?: string | null } }> }>;
    };
  };
};

type OpenAiConstructor = {
  default?: new (options: { apiKey?: string; baseURL?: string; timeout?: number }) => OpenAiChatClient;
  new (options: { apiKey?: string; baseURL?: string; timeout?: number }): OpenAiChatClient;
};

let openAiClient: OpenAiChatClient | null = null;
let openAiClientBaseUrl: string | null = null;

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function getOpenAiClient(): OpenAiChatClient {
  if (openAiClient && openAiClientBaseUrl === journalLlmBaseUrl) {
    return openAiClient;
  }

  const ctor = OpenAI as unknown as OpenAiConstructor;
  const OpenAiClass = ctor.default ?? ctor;

  openAiClient = new OpenAiClass({
    apiKey: env.JOURNAL_LLM_API_KEY,
    baseURL: journalLlmBaseUrl,
    timeout: env.JOURNAL_LLM_TIMEOUT_MS,
  });
  openAiClientBaseUrl = journalLlmBaseUrl ?? null;

  return openAiClient;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim();
}

function extractBalancedJson(value: string, startIndex: number): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < value.length; i += 1) {
    const ch = value[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") {
      stack.push("}");
      continue;
    }
    if (ch === "[") {
      stack.push("]");
      continue;
    }
    if (ch === "}" || ch === "]") {
      const expected = stack.pop();
      if (!expected || expected !== ch) {
        return null;
      }
      if (stack.length === 0) {
        return value.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function extractJsonLikeContent(value: string): string {
  const trimmed = value.trim();
  const withoutThink = trimmed.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const fencedMatch = withoutThink.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const unfenced = stripCodeFence(withoutThink);
  const firstArray = unfenced.indexOf("[");
  const firstObject = unfenced.indexOf("{");

  let startIndex = -1;
  if (firstArray >= 0 && firstObject >= 0) {
    startIndex = Math.min(firstArray, firstObject);
  } else if (firstArray >= 0) {
    startIndex = firstArray;
  } else if (firstObject >= 0) {
    startIndex = firstObject;
  }

  if (startIndex < 0) {
    return unfenced;
  }

  const balanced = extractBalancedJson(unfenced, startIndex);
  return balanced?.trim() || unfenced;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toFiniteConfidence(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

function normalizeCompositeLlmArray(raw: unknown): unknown[] | null {
  const rootArray = Array.isArray(raw) ? raw : (asRecord(raw) ? [raw] : null);
  if (!rootArray) {
    return null;
  }

  const normalized: Array<{
    confidence?: number;
    fields: Record<string, unknown>;
    kind: typeof INGEST_KINDS[number];
    warnings: string[];
  }> = [];

  for (const item of rootArray) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const directKind = typeof record.kind === "string" ? record.kind.trim().toLowerCase() : "";
    const directFields = asRecord(record.fields);
    if (INGEST_KIND_SET.has(directKind) && directFields) {
      normalized.push({
        kind: directKind as typeof INGEST_KINDS[number],
        fields: directFields,
        confidence: toFiniteConfidence(record.confidence),
        warnings: Array.isArray(record.warnings)
          ? record.warnings.filter((value): value is string => typeof value === "string")
          : [],
      });
      continue;
    }

    const rootConfidence = toFiniteConfidence(record.confidence);
    const rootWarnings = ["Normalized composite model output into entry candidates."];

    const goalRecord = asRecord(record.goal);
    const goalWeekStart = toText(record.goalWeekStart) || toText(goalRecord?.weekStart);
    const goalPlanText = toText(record.planText)
      || toText(goalRecord?.planText)
      || toText(goalRecord?.summary)
      || toText(goalRecord?.notes);
    if (goalWeekStart || goalPlanText) {
      normalized.push({
        kind: "goal",
        fields: {
          weekStart: goalWeekStart,
          planText: goalPlanText,
        },
        confidence: rootConfidence,
        warnings: rootWarnings,
      });
    }

    for (const kind of ["practice", "match", "diet", "exercise"] as const) {
      const section = asRecord(record[kind]);
      if (!section) {
        continue;
      }
      normalized.push({
        kind,
        fields: section,
        confidence: rootConfidence ?? toFiniteConfidence(section.confidence),
        warnings: rootWarnings,
      });
    }
  }

  return normalized.length > 0 ? normalized : null;
}

function toStructuredItems(raw: unknown): StructuredIngestInput[] {
  const direct = llmResponseSchema.safeParse(raw);
  const parsed = direct.success
    ? direct.data
    : llmResponseSchema.parse(normalizeCompositeLlmArray(raw) ?? raw);
  return parsed.map((item) => ({
    confidence: item.confidence,
    fields: item.fields,
    kind: item.kind,
    source: "journal-ai",
    warnings: item.warnings ?? [],
  }));
}

function withWarning(item: StructuredIngestInput, warning: string): StructuredIngestInput {
  const warnings = Array.isArray(item.warnings)
    ? item.warnings.filter((value): value is string => typeof value === "string")
    : [];
  if (warnings.includes(warning)) {
    return item;
  }
  return { ...item, warnings: [...warnings, warning] };
}

export function applyJournalDateDefaults(items: StructuredIngestInput[], today: string): StructuredIngestInput[] {
  return items.map((item) => {
    const kind = typeof item.kind === "string" ? item.kind : "";
    const fields = typeof item.fields === "object" && item.fields !== null
      ? { ...(item.fields as Record<string, unknown>) }
      : {};

    if (kind === "goal") {
      const weekStart = typeof fields.weekStart === "string" ? fields.weekStart.trim() : "";
      if (!weekStart) {
        fields.weekStart = today;
        const updated = { ...item, fields };
        return withWarning(updated, `weekStart missing; assumed today's date (${today}).`);
      }
      return { ...item, fields };
    }

    if (kind === "practice" || kind === "match" || kind === "diet" || kind === "exercise") {
      const date = typeof fields.date === "string" ? fields.date.trim() : "";
      if (!date) {
        fields.date = today;
        const updated = { ...item, fields };
        return withWarning(updated, `date missing; assumed today's date (${today}).`);
      }
      return { ...item, fields };
    }

    return item;
  });
}

const EXERCISE_TYPES = new Set(["Strength", "Cardio", "Mobility", "Recovery", "Other"]);

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toNullableText(value: unknown): string | null {
  const text = toText(value);
  return text.length > 0 ? text : null;
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function toPositiveInt(value: unknown, fallback = 30): number {
  const parsed = typeof value === "number" ? value : Number(toText(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.round(parsed);
}

function truncate(value: string, max = 120): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 3).trimEnd()}...`;
}

function uniqueWarnings(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : [];
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
}

function sanitizeCandidate(item: StructuredIngestInput): StructuredIngestInput {
  const kind = typeof item.kind === "string" ? item.kind : "";
  const fields = typeof item.fields === "object" && item.fields !== null
    ? item.fields as Record<string, unknown>
    : {};
  const warnings = uniqueWarnings(item.warnings);
  const rawKeys = Object.keys(fields);

  const extraKeysWarning = (allowed: string[]) => {
    const extras = rawKeys.filter((key) => !allowed.includes(key));
    if (extras.length > 0) {
      warnings.push(`Dropped unsupported fields: ${extras.join(", ")}.`);
    }
  };

  if (kind === "goal") {
    const allowed = ["weekStart", "planText"];
    extraKeysWarning(allowed);
    const planText = toText(fields.planText) || toText(fields.notes) || "General goal";
    if (!toText(fields.planText)) {
      warnings.push("planText missing; used best-fit default.");
    }
    return { ...item, fields: { weekStart: toText(fields.weekStart), planText }, warnings };
  }

  if (kind === "practice") {
    const allowed = ["date", "withCoach", "coachName", "workedOn", "notes"];
    extraKeysWarning(allowed);
    const workedOn = toText(fields.workedOn) || toText(fields.notes) || "General practice";
    const notes = toText(fields.notes);
    if (!toText(fields.workedOn)) {
      warnings.push("workedOn missing; used best-fit default.");
    }
    return {
      ...item,
      fields: {
        date: toText(fields.date),
        withCoach: toBoolean(fields.withCoach, false),
        coachName: toNullableText(fields.coachName),
        workedOn,
        notes,
      },
      warnings,
    };
  }

  if (kind === "match") {
    const allowed = ["date", "opponent", "score", "notes"];
    extraKeysWarning(allowed);
    const notes = toText(fields.notes);
    const opponent = toText(fields.opponent) || `Unknown opponent (${truncate(notes || "not specified", 40)})`;
    if (!toText(fields.opponent)) {
      warnings.push("opponent missing; used best-fit default.");
    }
    return {
      ...item,
      fields: {
        date: toText(fields.date),
        opponent,
        score: toText(fields.score),
        notes,
      },
      warnings,
    };
  }

  if (kind === "diet") {
    const allowed = ["date", "summary"];
    extraKeysWarning(allowed);
    const summary = toText(fields.summary) || toText(fields.notes) || "Diet note";
    if (!toText(fields.summary)) {
      warnings.push("summary missing; used best-fit default.");
    }
    return { ...item, fields: { date: toText(fields.date), summary }, warnings };
  }

  if (kind === "exercise") {
    const allowed = ["date", "durationMin", "exerciseType", "notes"];
    extraKeysWarning(allowed);
    const exerciseType = toText(fields.exerciseType);
    if (!EXERCISE_TYPES.has(exerciseType)) {
      warnings.push("exerciseType missing/invalid; defaulted to Other.");
    }
    return {
      ...item,
      fields: {
        date: toText(fields.date),
        durationMin: toPositiveInt(fields.durationMin, 30),
        exerciseType: EXERCISE_TYPES.has(exerciseType) ? exerciseType : "Other",
        notes: toText(fields.notes),
      },
      warnings,
    };
  }

  return item;
}

export function parseJournalLlmJson(content: string): StructuredIngestInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonLikeContent(content));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON.";
    throw new Error(`Could not parse LLM JSON response: ${message}`);
  }
  return toStructuredItems(parsed).map(sanitizeCandidate);
}

export type JournalLlmExtractionResult = {
  items: StructuredIngestInput[];
  parsedOutputJson: string;
  promptText: string;
  rawOutputText: string;
};

export type JournalLlmSentimentResult = {
  confidence?: number;
  format: "formal" | "informal";
  intensity: "high" | "medium" | "low";
  mood: "positive" | "neutral" | "negative";
  tags: string[];
};

export type JournalLlmSentimentExtractionResult = {
  parsedOutputJson: string;
  promptText: string;
  rawOutputText: string;
  sentiment: JournalLlmSentimentResult;
};

export class JournalLlmExtractionError extends Error {
  rawOutputText?: string;

  constructor(message: string, rawOutputText?: string) {
    super(message);
    this.name = "JournalLlmExtractionError";
    this.rawOutputText = rawOutputText;
  }
}

const SENTIMENT_TAGS = new Set([
  "tactical",
  "physical",
  "mental",
  "coach",
  "match-play",
  "recovery",
  "nutrition",
  "social",
  "breakthrough",
  "struggle",
  "fun",
]);

const llmSentimentSchema = z.object({
  confidence: z.number().min(0).max(1).optional(),
  format: z.enum(["formal", "informal"]),
  intensity: z.enum(["high", "medium", "low"]),
  mood: z.enum(["positive", "neutral", "negative"]),
  tags: z.array(z.string()).default([]),
}).strict();

function parseJournalSentimentJson(content: string): JournalLlmSentimentResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonLikeContent(content));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON.";
    throw new JournalLlmExtractionError(`Could not parse LLM sentiment JSON response: ${message}`, content);
  }

  const record = Array.isArray(parsed) ? parsed[0] : parsed;
  const normalized = llmSentimentSchema.parse(record);
  const tags = normalized.tags
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => SENTIMENT_TAGS.has(tag));

  return {
    mood: normalized.mood,
    intensity: normalized.intensity,
    format: normalized.format,
    tags,
    confidence: normalized.confidence,
  };
}

const SYSTEM_PROMPT_SINGLE_PASS = [
  "You convert tennis journal text into structured JSON entries.",
  "Convert input text into one or more entries using only this schema:",
  "Goal: weekStart (YYYY-MM-DD), planText",
  "Practice: date (YYYY-MM-DD), withCoach (true|false), coachName (string|null), workedOn, notes",
  "Match: date (YYYY-MM-DD), opponent, score, notes",
  "Diet: date (YYYY-MM-DD), summary",
  "Exercise: date (YYYY-MM-DD), durationMin (positive integer), exerciseType (Strength|Cardio|Mobility|Recovery|Other), notes",
  "Rules:",
  "1. Return JSON array only. No markdown, no prose, no wrapper objects.",
  "2. Each array item must be: {\"kind\":\"goal|practice|match|diet|exercise\",\"fields\":{...},\"confidence\":0.0-1.0,\"warnings\":[]}.",
  "3. Use only allowed fields for the chosen kind. No extra field names.",
  "4. Always emit at least one best-fit entry when there is any meaningful tennis, goal, diet, or exercise signal.",
  "5. Do not invent specific people, scores, or dates.",
  "6. If date/weekStart is missing, leave it blank and add warning; downstream will default to today's date.",
  "7. If details are missing, keep best evidence in:",
  "- goal.planText",
  "- practice.notes",
  "- match.notes",
  "- diet.summary",
  "- exercise.notes",
  "8. Safe defaults when uncertain: withCoach=false, coachName=null, score=\"\", durationMin=30, exerciseType=Other.",
  "9. Return [] only if there is truly no relevant signal.",
].join("\n");

// Compact variant: ~40% fewer tokens, disambiguates practice vs exercise,
// shows multi-entry pattern explicitly. Preferred for ≤3B parameter models.
export const SYSTEM_PROMPT_COMPACT = [
  "Extract structured entries from a tennis journal. Output ONLY a JSON array, nothing else.",
  "",
  "Entry format: {\"kind\":\"...\",\"fields\":{...},\"confidence\":0.9,\"warnings\":[]}",
  "",
  "Kinds and fields:",
  "- practice (on-court tennis session): date, workedOn, withCoach(true/false), coachName(null), notes",
  "- match (competitive game played): date, opponent, score, notes",
  "- diet (food, meals, nutrition): date, summary",
  "- exercise (off-court: gym, cardio, bike, mobility, stretching): date, durationMin, exerciseType(Strength|Cardio|Mobility|Recovery|Other), notes",
  "- goal (weekly training plan): weekStart, planText",
  "",
  "Rules:",
  "1. A single journal may produce multiple entries. Example: tennis + gym + dinner = [practice, exercise, diet].",
  "2. Always emit at least one entry. Never return [].",
  "3. Leave date blank if not stated in the text. Defaults: withCoach=false, coachName=null, durationMin=30, exerciseType=Other.",
  "4. JSON array only. No markdown fences, no explanation text.",
].join("\n");

// Sentiment/tagging prompt — returns a single object, not an array.
// Extracts mood, intensity, format, and free tags from a journal entry.
// Designed to work well on 1B-class models as a lightweight complement to
// structured extraction.
export const SYSTEM_PROMPT_SENTIMENT = [
  "Analyze a tennis journal entry and output a single JSON object. No other text.",
  "",
  "Output format:",
  "{\"mood\":\"...\",\"intensity\":\"...\",\"format\":\"...\",\"tags\":[],\"confidence\":0.9}",
  "",
  "Fields:",
  "- mood: overall emotional tone → positive | neutral | negative",
  "  positive: won, felt good, things clicked, breakthrough, energized, proud",
  "  negative: lost, frustrated, tired, struggled, disappointed, off-day",
  "  neutral: mixed or matter-of-fact, neither clearly positive nor negative",
  "- intensity: effort level of the primary activity → high | medium | low",
  "- format: session type → formal | informal",
  "  formal = coached session or competitive match",
  "  informal = everything else (solo, unstructured, cross-training, recovery)",
  "- tags: array from: tactical, physical, mental, coach, match-play, recovery, nutrition, social, breakthrough, struggle, fun",
  "- confidence: 0.0-1.0",
  "",
  "Rules:",
  "1. JSON object only. No markdown fences, no explanation.",
  "2. Exactly one value each for mood, intensity, format.",
  "3. tags may be [] or contain multiple values — only use words from the list above.",
].join("\n");

const SYSTEM_PROMPT_PASS_ONE = [
  "You are pass 1 of a 2-pass journal extraction pipeline.",
  "Goal: maximize recall of meaningful tennis, goal, diet, and exercise signals from freeform journal text.",
  "Extract one or more candidate spans. A single span may map to multiple kinds.",
  "Kinds: goal, practice, match, diet, exercise.",
  "Rules:",
  "1. Prefer over-including relevant spans instead of dropping them.",
  "2. Keep textSpan concise but faithful to source wording.",
  "3. inferredKinds must include at least one kind, can include several.",
  "4. If information is mixed with life context, keep useful context in textSpan.",
  "5. Return JSON only.",
  "Output format:",
  "{\"candidates\":[{\"textSpan\":\"...\",\"inferredKinds\":[\"practice\",\"goal\"],\"confidence\":0.0,\"warnings\":[]}]}",
].join("\n");

const SYSTEM_PROMPT_PASS_TWO = [
  "You are pass 2 of a 2-pass journal extraction pipeline.",
  "Input contains original journal text plus recall candidates from pass 1.",
  "Convert them into final structured entries.",
  "Entry types and fields:",
  "Goal: weekStart (YYYY-MM-DD), planText",
  "Practice: date (YYYY-MM-DD), withCoach (true|false), coachName (string|null), workedOn, notes",
  "Match: date (YYYY-MM-DD), opponent, score, notes",
  "Diet: date (YYYY-MM-DD), summary",
  "Exercise: date (YYYY-MM-DD), durationMin (positive integer), exerciseType (Strength|Cardio|Mobility|Recovery|Other), notes",
  "Rules:",
  "1. Always emit at least one best-fit entry if any candidate has meaningful signal.",
  "2. Do not invent specific names, scores, or dates.",
  "3. If date is missing, use today's date and add warning.",
  "4. If fields are missing, use safe defaults and preserve details in notes/summary/planText.",
  "5. One candidate can produce multiple entry kinds.",
  "6. Return JSON only.",
  "Output format (strict):",
  "[{\"kind\":\"goal|practice|match|diet|exercise\",\"fields\":{},\"confidence\":0.0,\"warnings\":[]}]",
].join("\n");

/**
 * Returns true for models whose parameter count is likely ≤3B.
 * These benefit from the compact prompt with fewer rules and clearer examples.
 * Pattern matches: "1b", "1.2b", "1.5b", "2b", "2.7b", etc.
 */
export function isSmallModel(model: string): boolean {
  return /1b[^0-9]|1b$|[0-9]\.[0-9]+b([^0-9]|$)|^[23]b([^0-9]|$)|[^0-9][23]b([^0-9]|$)/i.test(model);
}

/**
 * Selects the system prompt for a single-pass extraction.
 * Env var JOURNAL_LLM_PROMPT_VARIANT overrides auto-detection:
 *   "compact"   → always use compact prompt
 *   "standard"  → always use standard single-pass prompt
 *   (unset)     → auto-detect from model name
 */
function selectSinglePassPrompt(model: string): string {
  const override = (process.env.JOURNAL_LLM_PROMPT_VARIANT ?? "").trim().toLowerCase();
  if (override === "compact") return SYSTEM_PROMPT_COMPACT;
  if (override === "standard") return SYSTEM_PROMPT_SINGLE_PASS;
  return isSmallModel(model) ? SYSTEM_PROMPT_COMPACT : SYSTEM_PROMPT_SINGLE_PASS;
}

async function runCompletion(params: {
  client: OpenAiChatClient;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}) {
  const temperature = params.model === "gemma-3-1b-it-qat" ? 0.8 : 0;
  return params.client.chat.completions.create({
    model: params.model,
    temperature,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt },
    ],
  });
}

function renderPromptDebug(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  phase?: string;
}) {
  const phaseLabel = params.phase?.trim() ? ` (${params.phase.trim()})` : "";
  return [
    `model: ${params.model}${phaseLabel}`,
    "",
    "[system]",
    params.systemPrompt,
    "",
    "[user]",
    params.userPrompt,
  ].join("\n");
}

function contentFromCompletion(completion: Awaited<ReturnType<typeof runCompletion>>): string {
  const content = completion.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM response was empty.");
  }
  return content;
}

function inferFallbackKind(textSpan: string): StructuredIngestInput["kind"] {
  const lower = textSpan.toLowerCase();
  if (/(match|set|tiebreak|opponent|won|lost|score)/.test(lower)) {
    return "match";
  }
  if (/(coach|practice|court|serve|return|rally|backhand|forehand|tennis)/.test(lower)) {
    return "practice";
  }
  if (/(diet|meal|grocery|hydration|protein|yogurt|rice|chicken|salmon|food|dinner|lunch)/.test(lower)) {
    return "diet";
  }
  if (/(workout|strength|cardio|mobility|recovery|bike|run|stretch|exercise)/.test(lower)) {
    return "exercise";
  }
  if (/(goal|focus|plan|target|next time)/.test(lower)) {
    return "goal";
  }
  return "practice";
}

type PassOneCandidate = {
  confidence?: number;
  inferredKinds: StructuredIngestInput["kind"][];
  textSpan: string;
  warnings?: string[];
};

function normalizePassOneCandidates(raw: z.infer<typeof llmPassOneSchema>): PassOneCandidate[] {
  const source = Array.isArray(raw) ? raw : raw.candidates;
  const kindSet = new Set<string>(INGEST_KINDS);
  const normalized: PassOneCandidate[] = [];

  for (const item of source) {
    const textSpan = typeof item.textSpan === "string" ? item.textSpan.trim() : "";
    if (!textSpan) {
      continue;
    }
    const inferredRaw = Array.isArray(item.inferredKinds) ? item.inferredKinds : [];
    const inferredKinds = inferredRaw
      .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
      .filter((value) => kindSet.has(value)) as StructuredIngestInput["kind"][];
    const safeKinds = inferredKinds.length > 0 ? inferredKinds : [inferFallbackKind(textSpan)];
    const confidence = typeof item.confidence === "number" && item.confidence >= 0 && item.confidence <= 1
      ? item.confidence
      : undefined;
    const warnings = Array.isArray(item.warnings)
      ? item.warnings.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : undefined;
    normalized.push({
      textSpan,
      inferredKinds: safeKinds,
      confidence,
      warnings,
    });
  }

  return normalized;
}

function parsePassOneCandidates(content: string): PassOneCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonLikeContent(content));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON.";
    throw new JournalLlmExtractionError(`Could not parse LLM pass-1 JSON response: ${message}`, content);
  }
  const validRaw = llmPassOneSchema.parse(parsed);
  return normalizePassOneCandidates(validRaw);
}

export async function extractJournalCandidatesLLM(
  text: string,
  options?: {
    model?: string;
  },
): Promise<JournalLlmExtractionResult> {
  if (!journalLlmEnabled) {
    throw new Error("Journal LLM is disabled or not configured.");
  }

  if (text.length > env.JOURNAL_LLM_MAX_INPUT_CHARS) {
    throw new Error(`Journal text exceeds max length (${env.JOURNAL_LLM_MAX_INPUT_CHARS} chars).`);
  }

  const client = getOpenAiClient();
  const model = options?.model?.trim() || env.JOURNAL_LLM_MODEL?.trim();
  if (!model) {
    throw new Error("No JOURNAL_LLM_MODEL configured.");
  }
  const today = todayIsoDate();

  if (env.JOURNAL_LLM_TWO_PASS) {
    const passOneUserPrompt = `Today's date is ${today}.\n\nJournal entry:\n${text}`;
    const passOneCompletion = await runCompletion({
      client,
      model,
      systemPrompt: SYSTEM_PROMPT_PASS_ONE,
      userPrompt: passOneUserPrompt,
    });
    const passOneContent = contentFromCompletion(passOneCompletion);
    const passOnePromptDebug = renderPromptDebug({
      model,
      systemPrompt: SYSTEM_PROMPT_PASS_ONE,
      userPrompt: passOneUserPrompt,
      phase: "pass-1",
    });
    const passOneCandidates = parsePassOneCandidates(passOneContent);
    if (passOneCandidates.length === 0) {
      const singlePassUserPrompt = `Today's date is ${today}.\n\nJournal entry:\n${text}`;
      const singlePassCompletion = await runCompletion({
        client,
        model,
        systemPrompt: selectSinglePassPrompt(model),
        userPrompt: singlePassUserPrompt,
      });
      const singlePassContent = contentFromCompletion(singlePassCompletion);
      const singlePassPromptDebug = renderPromptDebug({
        model,
        systemPrompt: SYSTEM_PROMPT_SINGLE_PASS,
        userPrompt: singlePassUserPrompt,
        phase: "single-pass-fallback",
      });
      let parsedSinglePass: StructuredIngestInput[];
      try {
        parsedSinglePass = parseJournalLlmJson(singlePassContent);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not parse single-pass output.";
        throw new JournalLlmExtractionError(message, singlePassContent);
      }
      const items = applyJournalDateDefaults(parsedSinglePass, today);
      return {
        items,
        parsedOutputJson: JSON.stringify(items, null, 2),
        promptText: `${passOnePromptDebug}\n\n---\n\n${singlePassPromptDebug}`,
        rawOutputText: singlePassContent,
      };
    }

    const passTwoUserPrompt = [
      `Today's date is ${today}.`,
      "Original journal entry:",
      text,
      "",
      "Pass 1 recall candidates:",
      JSON.stringify({ candidates: passOneCandidates }),
    ].join("\n");
    const passTwoCompletion = await runCompletion({
      client,
      model,
      systemPrompt: SYSTEM_PROMPT_PASS_TWO,
      userPrompt: passTwoUserPrompt,
    });
    const passTwoContent = contentFromCompletion(passTwoCompletion);
    const passTwoPromptDebug = renderPromptDebug({
      model,
      systemPrompt: SYSTEM_PROMPT_PASS_TWO,
      userPrompt: passTwoUserPrompt,
      phase: "pass-2",
    });
    let parsedPassTwo: StructuredIngestInput[];
    try {
      parsedPassTwo = parseJournalLlmJson(passTwoContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not parse pass-2 output.";
      throw new JournalLlmExtractionError(message, passTwoContent);
    }
    const items = applyJournalDateDefaults(parsedPassTwo, today);
    return {
      items,
      parsedOutputJson: JSON.stringify(items, null, 2),
      promptText: `${passOnePromptDebug}\n\n---\n\n${passTwoPromptDebug}`,
      rawOutputText: passTwoContent,
    };
  }

  const singlePassUserPrompt = `Today's date is ${today}.\n\nJournal entry:\n${text}`;
  const completion = await runCompletion({
    client,
    model,
    systemPrompt: selectSinglePassPrompt(model),
    userPrompt: singlePassUserPrompt,
  });
  const content = contentFromCompletion(completion);
  const promptDebug = renderPromptDebug({
    model,
    systemPrompt: SYSTEM_PROMPT_SINGLE_PASS,
    userPrompt: singlePassUserPrompt,
  });
  let parsed: StructuredIngestInput[];
  try {
    parsed = parseJournalLlmJson(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not parse single-pass output.";
    throw new JournalLlmExtractionError(message, content);
  }
  const items = applyJournalDateDefaults(parsed, today);
  return { items, parsedOutputJson: JSON.stringify(items, null, 2), promptText: promptDebug, rawOutputText: content };
}

export async function extractJournalSentimentLLM(
  text: string,
  options?: {
    model?: string;
  },
): Promise<JournalLlmSentimentExtractionResult> {
  if (!journalLlmEnabled) {
    throw new Error("Journal LLM is disabled or not configured.");
  }

  if (text.length > env.JOURNAL_LLM_MAX_INPUT_CHARS) {
    throw new Error(`Journal text exceeds max length (${env.JOURNAL_LLM_MAX_INPUT_CHARS} chars).`);
  }

  const client = getOpenAiClient();
  const model = options?.model?.trim() || env.JOURNAL_LLM_MODEL?.trim();
  if (!model) {
    throw new Error("No JOURNAL_LLM_MODEL configured.");
  }

  const userPrompt = text;
  const completion = await runCompletion({
    client,
    model,
    systemPrompt: SYSTEM_PROMPT_SENTIMENT,
    userPrompt,
  });
  const content = contentFromCompletion(completion);
  let sentiment: JournalLlmSentimentResult;
  try {
    sentiment = parseJournalSentimentJson(content);
  } catch (error) {
    if (error instanceof JournalLlmExtractionError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Could not parse sentiment output.";
    throw new JournalLlmExtractionError(message, content);
  }

  const promptDebug = renderPromptDebug({
    model,
    systemPrompt: SYSTEM_PROMPT_SENTIMENT,
    userPrompt,
    phase: "sentiment",
  });

  return {
    sentiment,
    parsedOutputJson: JSON.stringify(sentiment, null, 2),
    promptText: promptDebug,
    rawOutputText: content,
  };
}
