import "dotenv/config";

import { z } from "zod";

const ingestApiKeyRecordSchema = z
  .object({
    allowedUserIds: z.array(z.string().min(1)).optional(),
    id: z.string().min(1),
    key: z.string().min(1),
    scopes: z.array(z.enum(["ingest:write", "ingest:dryrun"])).min(1),
  })
  .strict();

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  NEON_AUTH_BASE_URL: z.string().url().optional(),
  NEON_AUTH_COOKIE_SECRET: z.string().optional(),
  INGEST_API_KEY: z.string().min(1).optional(),
  INGEST_API_KEYS_JSON: z.string().optional(),
  INGEST_CLEANUP_INTERVAL_MS: z.coerce.number().int().positive().default(60 * 1000),
  INGEST_IDEMPOTENCY_TTL_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  INGEST_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  INGEST_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
  APP_URL: z.string().url().default("http://localhost:3001"),
  PORT: z.coerce.number().int().positive().default(3001),
});

const parsedEnv = envSchema.parse(process.env);

export const env = {
  ...parsedEnv,
};

export type IngestApiKeyRecord = z.infer<typeof ingestApiKeyRecordSchema>;

function parseIngestApiKeys(json: string | undefined): IngestApiKeyRecord[] {
  if (!json?.trim()) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("INGEST_API_KEYS_JSON must be valid JSON.");
  }

  const validated = z.array(ingestApiKeyRecordSchema).min(1).safeParse(parsed);
  if (!validated.success) {
    const message = validated.error.issues[0]?.message ?? "Invalid INGEST_API_KEYS_JSON.";
    throw new Error(`INGEST_API_KEYS_JSON invalid: ${message}`);
  }

  return validated.data;
}

export const ingestApiKeys: IngestApiKeyRecord[] = (() => {
  const parsed = parseIngestApiKeys(env.INGEST_API_KEYS_JSON);
  if (parsed.length > 0) {
    return parsed;
  }
  if (env.INGEST_API_KEY) {
    return [
      {
        id: "default",
        key: env.INGEST_API_KEY,
        scopes: ["ingest:write", "ingest:dryrun"],
      },
    ];
  }
  return [];
})();

export const authConfigured = Boolean(env.NEON_AUTH_BASE_URL && env.NEON_AUTH_COOKIE_SECRET);
export const dbConfigured = Boolean(env.DATABASE_URL);
export const ingestApiConfigured = ingestApiKeys.length > 0;
