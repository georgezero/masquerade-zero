import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { env } from "../env.js";
import * as schema from "./schema.js";

// Ensure data directory exists for local SQLite files
if (env.DATABASE_URL.startsWith("file:")) {
  const filePath = env.DATABASE_URL.replace("file:", "");
  const dir = dirname(filePath);
  if (dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }
}

const client = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

// Enable WAL mode for concurrent reads during writes (local SQLite only)
if (env.DATABASE_URL.startsWith("file:")) {
  await client.execute("PRAGMA journal_mode=WAL;");
}

export const db = drizzle(client, { schema });

export { schema };
