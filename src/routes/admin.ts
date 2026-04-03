import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { adminPage } from "../templates/admin.js";

export const adminRouter = new Hono();

// HTTP Basic Auth middleware for all /admin routes
adminRouter.use("*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Basic ")) {
    c.header("WWW-Authenticate", 'Basic realm="Masquerade Admin"');
    return c.text("Unauthorized", 401);
  }
  const decoded = Buffer.from(auth.slice(6), "base64").toString();
  const [, password] = decoded.split(":");
  if (password !== env.ADMIN_PASSWORD) {
    c.header("WWW-Authenticate", 'Basic realm="Masquerade Admin"');
    return c.text("Unauthorized", 401);
  }
  await next();
});

// GET /admin — word pack management
adminRouter.get("/", async (c) => {
  const packs = await db.query.wordPacks.findMany({
    with: { pairs: { where: eq(schema.wordPairs.active, true) } },
    orderBy: (wp, { asc }) => [asc(wp.createdAt)],
  });
  return c.html(adminPage(packs as any));
});

// POST /admin/packs — create pack
adminRouter.post("/packs", async (c) => {
  const body = await c.req.parseBody();
  const name = String(body.name ?? "").trim();
  const category = String(body.category ?? "").trim();
  if (!name || !category) return c.redirect("/admin");

  await db.insert(schema.wordPacks).values({ name, category });
  return c.redirect("/admin");
});

// POST /admin/packs/:id/toggle — toggle active
adminRouter.post("/packs/:id/toggle", async (c) => {
  const pack = await db.query.wordPacks.findFirst({
    where: eq(schema.wordPacks.id, c.req.param("id")),
  });
  if (!pack) return c.redirect("/admin");
  await db
    .update(schema.wordPacks)
    .set({ active: !pack.active })
    .where(eq(schema.wordPacks.id, pack.id));
  return c.redirect("/admin");
});

// POST /admin/packs/:id/pairs — add word pair
adminRouter.post("/packs/:id/pairs", async (c) => {
  const body = await c.req.parseBody();
  const civilianWord = String(body.civilianWord ?? "").trim();
  const imposterWord = String(body.imposterWord ?? "").trim() || null;
  if (!civilianWord) return c.redirect("/admin");

  await db.insert(schema.wordPairs).values({
    packId: c.req.param("id"),
    civilianWord,
    imposterWord,
  });
  return c.redirect("/admin");
});

// POST /admin/packs/:id/pairs/:pid/delete — remove pair
adminRouter.post("/packs/:id/pairs/:pid/delete", async (c) => {
  await db
    .update(schema.wordPairs)
    .set({ active: false })
    .where(eq(schema.wordPairs.id, c.req.param("pid")));
  return c.redirect("/admin");
});

// POST /admin/packs/:id/delete — delete pack and all its pairs
adminRouter.post("/packs/:id/delete", async (c) => {
  await db.delete(schema.wordPairs).where(eq(schema.wordPairs.packId, c.req.param("id")));
  await db.delete(schema.wordPacks).where(eq(schema.wordPacks.id, c.req.param("id")));
  return c.redirect("/admin");
});
