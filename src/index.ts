import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { env } from "./env.js";
import { setDb } from "./db/index.js";
import * as schema from "./db/schema.js";
import app from "./app.js";

// ── Database setup ────────────────────────────────────────────────────────────

if (env.DATABASE_URL.startsWith("file:")) {
  const filePath = env.DATABASE_URL.replace("file:", "");
  const dir = dirname(filePath);
  if (dir !== ".") mkdirSync(dir, { recursive: true });
}

const client = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

if (env.DATABASE_URL.startsWith("file:")) {
  client.execute("PRAGMA journal_mode=WAL;").catch(() => {});
}

setDb(drizzle(client, { schema }));

// ── Static assets (served by Vercel CDN in production) ───────────────────────

app.use("/app.css", serveStatic({ path: "./public/app.css" }));
app.use("/app.js", serveStatic({ path: "./public/app.js" }));

// ── Start server ──────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: env.PORT }, () => {
  console.log(`Masquerade running on http://localhost:${env.PORT}`);
});
