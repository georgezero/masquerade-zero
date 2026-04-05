import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

import { env } from "./env.js";
import app from "./app.js";

// Static assets (served by Vercel CDN in production)
app.use("/app.css", serveStatic({ path: "./public/app.css" }));
app.use("/app.js", serveStatic({ path: "./public/app.js" }));

serve({ fetch: app.fetch, port: env.PORT }, () => {
  console.log(`Masquerade running on http://localhost:${env.PORT}`);
});
