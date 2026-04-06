import { handle } from "hono/vercel";
import { createClient } from "@libsql/client/http";
import { drizzle } from "drizzle-orm/libsql";

import { env } from "../src/env.js";
import { setDb } from "../src/db/index.js";
import * as schema from "../src/db/schema.js";
import app from "../src/app.js";

// Use https:// for HTTP transport — libsql:// uses WebSockets which hang in serverless
const url = env.DATABASE_URL.startsWith("libsql://")
  ? env.DATABASE_URL.replace("libsql://", "https://")
  : env.DATABASE_URL;

const client = createClient({ url, authToken: env.DATABASE_AUTH_TOKEN });
setDb(drizzle(client, { schema }));

export const config = { runtime: "edge" };
export default handle(app);
