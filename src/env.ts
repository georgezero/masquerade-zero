import "dotenv/config";

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  NEON_AUTH_BASE_URL: z.string().url().optional(),
  NEON_AUTH_COOKIE_SECRET: z.string().optional(),
  INGEST_API_KEY: z.string().min(1).optional(),
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

export const authConfigured = Boolean(env.NEON_AUTH_BASE_URL && env.NEON_AUTH_COOKIE_SECRET);
export const dbConfigured = Boolean(env.DATABASE_URL);
export const ingestApiConfigured = Boolean(env.INGEST_API_KEY);
