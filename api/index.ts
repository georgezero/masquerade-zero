import { handle } from "hono/vercel";
import { Hono } from "hono";

// Minimal test — no app imports, no db, no dotenv
const testApp = new Hono();
testApp.get("/ping", (c) => c.json({ ok: true }));
testApp.get("/", (c) => c.text("hello from vercel"));

export const config = { runtime: "nodejs" };
export default handle(testApp);
