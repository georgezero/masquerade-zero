import { Hono } from "hono";
import { trimTrailingSlash } from "hono/trailing-slash";

import { gameRouter } from "./routes/game.js";
import { adminRouter } from "./routes/admin.js";
import { env } from "./env.js";

const app = new Hono();

app.use(trimTrailingSlash());

app.get("/debug-env", (c) => {
  return c.json({
    db_url: env.DATABASE_URL,
    has_auth_token: !!env.DATABASE_AUTH_TOKEN,
    node_env: env.NODE_ENV,
  });
});

app.route("/", gameRouter);
app.route("/admin", adminRouter);

export default app;
