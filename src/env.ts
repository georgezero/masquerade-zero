// dotenv is loaded by src/index.ts (RPI/Node.js entry only).
// On Vercel, env vars are injected into process.env automatically.
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1).default("file:./data/masquerade.db"),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  ADMIN_PASSWORD: z.string().min(1).default("changeme"),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
