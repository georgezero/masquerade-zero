import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { trimTrailingSlash } from "hono/trailing-slash";

import { env } from "./env.js";
import { gameRouter } from "./routes/game.js";
import { adminRouter } from "./routes/admin.js";

const app = new Hono();

app.use(trimTrailingSlash());

// Static assets
app.use("/app.css", serveStatic({ path: "./public/app.css" }));
app.use("/app.js", serveStatic({ path: "./public/app.js" }));

// Game routes (mounted at root)
app.route("/", gameRouter);

// Admin routes
app.route("/admin", adminRouter);

serve({ fetch: app.fetch, port: env.PORT }, () => {
  console.log(`Masquerade running on http://localhost:${env.PORT}`);
});
