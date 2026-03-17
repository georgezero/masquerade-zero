import OpenAI from "openai";
import { z } from "zod";

import { env, journalLlmEnabled } from "../env.js";
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

const llmResponseSchema = z.union([
  z.array(llmCandidateSchema),
  z.object({ items: z.array(llmCandidateSchema) }).strict(),
]);

let openAiClient: OpenAI | null = null;

function getOpenAiClient(): OpenAI {
  if (openAiClient) {
    return openAiClient;
  }

  openAiClient = new OpenAI({
    apiKey: env.JOURNAL_LLM_API_KEY,
    baseURL: env.JOURNAL_LLM_BASE_URL,
    timeout: env.JOURNAL_LLM_TIMEOUT_MS,
  });

  return openAiClient;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim();
}

function toStructuredItems(raw: unknown): StructuredIngestInput[] {
  const parsed = llmResponseSchema.parse(raw);
  const items = Array.isArray(parsed) ? parsed : parsed.items;

  return items.map((item) => ({
    confidence: item.confidence,
    fields: item.fields,
    kind: item.kind,
    source: "journal-ai",
    warnings: item.warnings ?? [],
  }));
}

export function parseJournalLlmJson(content: string): StructuredIngestInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(content));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON.";
    throw new Error(`Could not parse LLM JSON response: ${message}`);
  }
  return toStructuredItems(parsed);
}

const SYSTEM_PROMPT = [
  "You convert tennis journal text into structured JSON entries.",
  "Convert the input journal text (which may be freeform prose or structured lines) into one or more of these entry types and fields:",
  "Goal: weekStart (YYYY-MM-DD), planText",
  "Practice: date (YYYY-MM-DD), withCoach (true|false), coachName (string|null), workedOn, notes",
  "Match: date (YYYY-MM-DD), opponent, score, notes",
  "Diet: date (YYYY-MM-DD), summary",
  "Exercise: date (YYYY-MM-DD), durationMin (positive integer), exerciseType (Strength|Cardio|Mobility|Recovery|Other), notes",
  "Rules:",
  "1. Extract only explicitly supported facts from the text.",
  "2. Do not invent people, scores, or dates.",
  "3. If date is missing but context clearly implies today, use the provided current date; otherwise set date to empty string and add a warning.",
  "4. If a field is uncertain, use empty string (or null for coachName) and add a warning.",
  "5. Return as many entries as are clearly present.",
  "6. Return valid JSON only, no markdown, no prose.",
  "Output format (strict):",
  "[{\"kind\":\"goal|practice|match|diet|exercise\",\"fields\":{},\"confidence\":0.0,\"warnings\":[]}]",
  "You may also return: {\"items\":[...]}",
].join("\n");

export async function extractJournalCandidatesLLM(
  text: string,
  options?: {
    model?: string;
  },
): Promise<StructuredIngestInput[]> {
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
  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM response was empty.");
  }

  return parseJournalLlmJson(content);
}
