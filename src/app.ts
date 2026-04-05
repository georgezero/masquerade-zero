import { Hono } from "hono";
import { trimTrailingSlash } from "hono/trailing-slash";

import { gameRouter } from "./routes/game.js";
import { adminRouter } from "./routes/admin.js";

const app = new Hono();

app.use(trimTrailingSlash());

app.route("/", gameRouter);
app.route("/admin", adminRouter);

export default app;
