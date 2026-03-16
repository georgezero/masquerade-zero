import { z } from "zod";

import { INGEST_KINDS } from "./types.js";

const trimmedRequiredText = (name: string) =>
  z
    .string({ required_error: `${name} is required.` })
    .trim()
    .min(1, `${name} is required.`);

const trimmedOptionalText = z.string().trim().default("");

const warningsSchema = z
  .array(z.string().trim().min(1))
  .default([])
  .transform((items) => items.map((item) => item.trim()));

export const goalFieldsSchema = z
  .object({
    planText: trimmedRequiredText("Plan text"),
    weekStart: trimmedRequiredText("Week start"),
  })
  .strict();

export const practiceFieldsSchema = z
  .object({
    coachName: z.string().trim().nullish().transform((value) => value ?? null),
    date: trimmedRequiredText("Date"),
    notes: trimmedOptionalText,
    withCoach: z.coerce.boolean().default(false),
    workedOn: trimmedRequiredText("Worked on"),
  })
  .strict();

export const matchFieldsSchema = z
  .object({
    date: trimmedRequiredText("Date"),
    notes: trimmedOptionalText,
    opponent: trimmedRequiredText("Opponent"),
    score: trimmedOptionalText,
  })
  .strict();

export const dietFieldsSchema = z
  .object({
    date: trimmedRequiredText("Date"),
    summary: trimmedRequiredText("Summary"),
  })
  .strict();

export const exerciseFieldsSchema = z
  .object({
    date: trimmedRequiredText("Date"),
    durationMin: z.coerce.number().int().positive("Duration must be greater than 0."),
    exerciseType: z.enum(["Strength", "Cardio", "Mobility", "Recovery", "Other"]).default("Other"),
    notes: trimmedOptionalText,
  })
  .strict();

export const ingestItemInputSchema = z
  .object({
    confidence: z.number().min(0).max(1).default(1),
    fields: z.unknown(),
    kind: z.enum(INGEST_KINDS),
    source: z.enum(["api", "mcp", "journal-ai", "manual"]).default("api"),
    warnings: warningsSchema,
  })
  .strict();

export const ingestStructuredItemRequestSchema = z
  .object({
    confidence: z.number().min(0).max(1).optional(),
    fields: z.unknown(),
    kind: z.unknown(),
    source: z.enum(["api", "mcp", "journal-ai", "manual"]).optional(),
    warnings: z.array(z.unknown()).optional(),
  })
  .strict();

export const ingestFieldsByKindSchema = {
  diet: dietFieldsSchema,
  exercise: exerciseFieldsSchema,
  goal: goalFieldsSchema,
  match: matchFieldsSchema,
  practice: practiceFieldsSchema,
} as const;

export const structuredIngestRequestSchema = z
  .object({
    dryRun: z.boolean().optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
    items: z.array(ingestStructuredItemRequestSchema).min(1, "At least one item is required."),
    mode: z.literal("structured"),
    userId: z.string().trim().min(1, "userId is required."),
  })
  .strict();

export const freeformIngestRequestSchema = z
  .object({
    dryRun: z.boolean().optional(),
    idempotencyKey: z.string().trim().min(1).optional(),
    mode: z.literal("freeform"),
    text: z.string().trim().min(1, "Text is required."),
    userId: z.string().trim().min(1, "userId is required."),
  })
  .strict();

export const ingestApiRequestSchema = z.discriminatedUnion("mode", [
  structuredIngestRequestSchema,
  freeformIngestRequestSchema,
]);
