import { Hono } from "hono";
import { trimTrailingSlash } from "hono/trailing-slash";

import { gameRouter } from "./routes/game.js";
import { adminRouter } from "./routes/admin.js";
import { db } from "./db/index.js";
import { env } from "./env.js";
import { sql } from "drizzle-orm";

const app = new Hono();

app.use(trimTrailingSlash());

app.get("/debug-db", async (c) => {
  try {
    await db.run(sql`SELECT 1`);
    return c.json({ ok: true, url: env.DATABASE_URL });
  } catch (e: any) {
    return c.json({ ok: false, url: env.DATABASE_URL, error: e.message }, 500);
  }
});

app.route("/", gameRouter);
app.route("/admin", adminRouter);

export default app;
