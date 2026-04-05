import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL ?? "file:./data/masquerade.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "turso",
  dbCredentials: {
    url: databaseUrl,
    authToken,
  },
  strict: true,
  verbose: true,
});
