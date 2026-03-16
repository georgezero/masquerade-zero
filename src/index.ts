import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import {
  deleteDiet,
  deleteExercise,
  deleteGoal,
  deleteMatch,
  deletePractice,
  ensureUserProfile,
  getEntryById,
  listHistory,
  toViewer,
  updateDiet,
  updateExercise,
  updateGoal,
  updateMatch,
  updatePractice,
  updateTennisProfile,
  type Viewer,
} from "./lib/app.js";
import { IngestService } from "./ingest/service.js";
import { PostgresIngestRuntime } from "./ingest/runtime.js";
import { ingestApiRequestSchema } from "./ingest/schemas.js";
import type { StructuredIngestInput } from "./ingest/types.js";
import { authConfigured, env, ingestApiConfigured, ingestApiKeys, type IngestApiKeyRecord } from "./env.js";
import { authJson, getAuthSession, proxyAuthRequest, setAuthCookies } from "./lib/auth.js";
import {
  authPanel,
  entryDetail,
  entryForm,
  entryLauncher,
  historySection,
  page,
  profileForm,
} from "./templates.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AppVariables = { viewer: Viewer };
type AppContext = Context<{ Variables: AppVariables }>;

const VALID_KINDS = ["goal", "practice", "match", "diet", "exercise"] as const;

function isValidKind(value: string): value is (typeof VALID_KINDS)[number] {
  return (VALID_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Variables: AppVariables }>();

// Static assets
app.use("/app.css", serveStatic({ path: "./public/app.css" }));
app.use("/app.js", serveStatic({ path: "./public/app.js" }));

// Force HTTPS for public hosts so secure auth cookies can be set reliably.
app.use("*", async (c, next) => {
  const forwardedProto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = (c.req.header("x-forwarded-host") || c.req.header("host") || "").split(",")[0]?.trim();
  const hostname = host.split(":")[0]?.toLowerCase();
  const localHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local");

  if (forwardedProto === "http" && host && !localHost) {
    const url = new URL(c.req.url);
    url.protocol = "https:";
    url.host = host;
    return c.redirect(url.toString(), 308);
  }

  await next();
});

// ---------------------------------------------------------------------------
// Viewer middleware
// ---------------------------------------------------------------------------

app.use("*", async (c, next) => {
  if (!authConfigured) {
    c.set("viewer", toViewer(null, null));
    await next();
    return;
  }

  const session = await getAuthSession(c.req.raw.headers);
  const profile = session?.user ? await ensureUserProfile(session.user) : null;
  c.set("viewer", toViewer(session?.user ?? null, profile));
  await next();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireAuth(viewer: Viewer): asserts viewer is Viewer & { authUser: NonNullable<Viewer["authUser"]> } {
  if (viewer.role === "guest" || !viewer.authUser) {
    throw new Error("Sign in required.");
  }
}

function setFlash(c: AppContext, message: string) {
  setCookie(c, "flash", message, { path: "/", httpOnly: true, sameSite: "Lax" });
}

function setFlashHeader(headers: Headers, message: string) {
  headers.append("set-cookie", `flash=${encodeURIComponent(message)}; Path=/; HttpOnly; SameSite=Lax`);
}

function getFlash(c: AppContext) {
  const flash = getCookie(c, "flash");
  if (flash) {
    deleteCookie(c, "flash", { path: "/" });
  }
  return flash;
}

function extractAuthMessage(responseText: string) {
  try {
    const parsed = JSON.parse(responseText) as { message?: string; code?: string };
    if (parsed?.message) {
      return parsed.code ? `${parsed.message} (${parsed.code})` : parsed.message;
    }
  } catch {
    // ignore non-JSON
  }
  return "";
}

function clearAuthCookies(headers: Headers) {
  const expired = "Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None; Partitioned";
  headers.append("set-cookie", `__Secure-neon-auth.session_token=; ${expired}`);
  headers.append("set-cookie", `__Secure-neon-auth.session_challenge=; ${expired}`);
}

function depluralize(plural: string): string {
  const map: Record<string, string> = { goals: "goal", practices: "practice", matches: "match", diets: "diet", exercises: "exercise" };
  return map[plural] ?? plural;
}

function ingestApiAuthKey(c: AppContext): string | null {
  const authHeader = c.req.header("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  return c.req.header("x-api-key")?.trim() || null;
}

function apiKeysMatch(expected: string, actual: string | null): boolean {
  if (!actual) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function resolveIngestApiKey(actual: string | null): IngestApiKeyRecord | null {
  if (!actual) {
    return null;
  }
  return ingestApiKeys.find((entry) => apiKeysMatch(entry.key, actual)) ?? null;
}

function keyHasAnyScope(key: IngestApiKeyRecord, scopes: Array<"ingest:write" | "ingest:dryrun">): boolean {
  return scopes.some((scope) => key.scopes.includes(scope));
}

// Dispatches update/delete based on kind
const ingestService = new IngestService();
const ingestRuntime = new PostgresIngestRuntime(
  env.INGEST_RATE_LIMIT_WINDOW_MS,
  env.INGEST_RATE_LIMIT_MAX,
  env.INGEST_IDEMPOTENCY_TTL_MS,
);

const updaters: Record<string, (userId: string, id: string, body: Record<string, unknown>) => Promise<unknown>> = {
  goal: updateGoal,
  practice: updatePractice,
  match: updateMatch,
  diet: updateDiet,
  exercise: updateExercise,
};

const deleters: Record<string, (userId: string, id: string) => Promise<void>> = {
  goal: deleteGoal,
  practice: deletePractice,
  match: deleteMatch,
  diet: deleteDiet,
  exercise: deleteExercise,
};

// ---------------------------------------------------------------------------
// Page routes — full HTML pages
// ---------------------------------------------------------------------------

// Home page
app.get("/", async (c) => {
  const viewer = c.get("viewer");
  c.header("Cache-Control", "no-store");

  const flash = getFlash(c);
  let bodyContent: string;
  let routeName: "home" | "demo" = "home";
  if (viewer.role === "guest") {
    // Guest users get demo mode with localStorage data on the home page
    routeName = "demo";
    bodyContent = "";
  } else if (viewer.profileRequired) {
    bodyContent = profileForm(viewer);
  } else {
    const { items, total } = await listHistory(viewer.authUser!.id, "all", 15, 0);
    bodyContent = historySection(items, total, "all");
  }

  return c.html(page({ viewer, route: routeName, flash, bodyContent }));
});

// Sign-in page (guest only)
app.get("/sign-in", async (c) => {
  const viewer = c.get("viewer");
  c.header("Cache-Control", "no-store");
  if (viewer.role !== "guest") {
    return c.redirect("/");
  }
  return c.html(page({ viewer, route: "sign-in", flash: getFlash(c), bodyContent: authPanel(viewer, true) }));
});

// Profile page
app.get("/profile", async (c) => {
  const viewer = c.get("viewer");
  if (viewer.role === "guest") {
    setFlash(c, "Sign in first.");
    return c.redirect("/");
  }
  c.header("Cache-Control", "no-store");

  const bodyContent = authPanel(viewer) + profileForm(viewer);
  return c.html(page({ viewer, route: "profile", flash: getFlash(c), bodyContent }));
});

// View entry detail:  GET /view/practice/abc123
app.get("/view/:kind/:id", async (c) => {
  const viewer = c.get("viewer");
  requireAuth(viewer);
  const kind = c.req.param("kind");
  const id = c.req.param("id");

  if (!isValidKind(kind)) {
    setFlash(c, "Unknown entry type.");
    return c.redirect("/");
  }

  const item = await getEntryById(viewer.authUser.id, kind, id);
  if (!item) {
    setFlash(c, "Entry not found.");
    return c.redirect("/");
  }

  c.header("Cache-Control", "no-store");
  return c.html(page({ viewer, route: "view", flash: getFlash(c), bodyContent: entryDetail(item) }));
});

// Edit entry form:  GET /edit/match/abc123
app.get("/edit/:kind/:id", async (c) => {
  const viewer = c.get("viewer");
  requireAuth(viewer);
  const kind = c.req.param("kind");
  const id = c.req.param("id");

  if (!isValidKind(kind)) {
    setFlash(c, "Unknown entry type.");
    return c.redirect("/");
  }

  const item = await getEntryById(viewer.authUser.id, kind, id);
  if (!item) {
    setFlash(c, "Entry not found.");
    return c.redirect("/");
  }

  c.header("Cache-Control", "no-store");
  return c.html(page({ viewer, route: "edit", flash: getFlash(c), bodyContent: entryForm(kind, item) }));
});

// New entry form:  GET /new/goal
app.get("/new/:kind", async (c) => {
  const viewer = c.get("viewer");
  requireAuth(viewer);
  const kind = c.req.param("kind");

  if (!isValidKind(kind)) {
    setFlash(c, "Unknown entry type.");
    return c.redirect("/");
  }

  c.header("Cache-Control", "no-store");
  return c.html(page({ viewer, route: "new", flash: getFlash(c), bodyContent: entryForm(kind) }));
});

// ---------------------------------------------------------------------------
// Demo routes — full page shell, JS handles everything client-side
// ---------------------------------------------------------------------------

app.get("/demo", async (c) => {
  const viewer = c.get("viewer");
  c.header("Cache-Control", "no-store");
  return c.html(page({ viewer, route: "demo", flash: getFlash(c), bodyContent: "" }));
});

app.get("/demo/view/:kind/:id", async (c) => {
  const viewer = c.get("viewer");
  c.header("Cache-Control", "no-store");
  return c.html(page({ viewer, route: "demo", flash: getFlash(c), bodyContent: "" }));
});

app.get("/demo/edit/:kind/:id", async (c) => {
  const viewer = c.get("viewer");
  c.header("Cache-Control", "no-store");
  return c.html(page({ viewer, route: "demo", flash: getFlash(c), bodyContent: "" }));
});

app.get("/demo/new/:kind", async (c) => {
  const viewer = c.get("viewer");
  c.header("Cache-Control", "no-store");
  return c.html(page({ viewer, route: "demo", flash: getFlash(c), bodyContent: "" }));
});

// ---------------------------------------------------------------------------
// HTMX API — return HTML fragments
// ---------------------------------------------------------------------------

// History feed (HTMX swap target: #feed)
app.get("/api/history", async (c) => {
  const viewer = c.get("viewer");
  requireAuth(viewer);

  const kind = c.req.query("kind") || "all";
  const limit = Math.min(Number(c.req.query("limit") || "15"), 50);
  const { items, total } = await listHistory(viewer.authUser.id, kind, limit, 0);
  return c.html(historySection(items, total, kind));
});

// Entry launcher panel (HTMX swap target: #main-content)
app.get("/api/entry-launcher", async (c) => {
  const viewer = c.get("viewer");
  requireAuth(viewer);
  return c.html(entryLauncher());
});

// Ingestion API: POST /api/ingest
app.post("/api/ingest", async (c) => {
  const contentLength = Number(c.req.header("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 100_000) {
    return c.json({ error: "Request body too large." }, 413);
  }

  if (!ingestApiConfigured) {
    return c.json({ error: "Ingest API is not configured." }, 503);
  }

  const providedApiKey = ingestApiAuthKey(c as AppContext);
  const resolvedApiKey = resolveIngestApiKey(providedApiKey);
  if (!resolvedApiKey) {
    return c.json({ error: "Unauthorized." }, 401);
  }

  let requestBody: unknown;
  try {
    requestBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON." }, 400);
  }

  const parsed = ingestApiRequestSchema.safeParse(requestBody);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid ingest request.";
    return c.json({ error: message }, 400);
  }

  const request = parsed.data;
  if (Array.isArray(resolvedApiKey.allowedUserIds) && !resolvedApiKey.allowedUserIds.includes(request.userId)) {
    return c.json({ error: "Forbidden for requested userId." }, 403);
  }

  if (request.mode === "structured") {
    const needsWrite = !request.dryRun;
    const permitted = needsWrite
      ? keyHasAnyScope(resolvedApiKey, ["ingest:write"])
      : keyHasAnyScope(resolvedApiKey, ["ingest:dryrun", "ingest:write"]);
    if (!permitted) {
      return c.json({ error: needsWrite ? "Missing scope: ingest:write." : "Missing scope: ingest:dryrun." }, 403);
    }
  } else if (!keyHasAnyScope(resolvedApiKey, ["ingest:dryrun", "ingest:write"])) {
    return c.json({ error: "Missing scope: ingest:dryrun." }, 403);
  }

  const requestFingerprint = createHash("sha256").update(JSON.stringify(request)).digest("hex");
  const clientKey = [resolvedApiKey.id, request.userId].filter(Boolean).join(":");
  const idempotencyCompositeKey = request.idempotencyKey
    ? `${request.userId}:${request.idempotencyKey}`
    : null;

  if (idempotencyCompositeKey) {
    const idemStatus = await ingestRuntime.beginIdempotentRequest(idempotencyCompositeKey, requestFingerprint);
    if (idemStatus.state === "replay") {
      return new Response(JSON.stringify(idemStatus.responseBody), {
        status: idemStatus.statusCode,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    if (idemStatus.state === "in_flight") {
      return c.json({ error: "Request with this idempotency key is already in progress." }, 409);
    }
    if (idemStatus.state === "conflict") {
      return c.json({ error: "Idempotency key already used with a different payload." }, 409);
    }
  }

  const rateLimit = await ingestRuntime.checkRateLimit(clientKey);
  if (!rateLimit.allowed) {
    c.header("Retry-After", String(rateLimit.retryAfterSec));
    return c.json({ error: "Rate limit exceeded." }, 429);
  }

  if (request.mode === "freeform") {
    const body = {
      accepted: false,
      candidates: [],
      created: [],
      errors: [{ index: -1, message: "Freeform mode is not implemented yet." }],
      warnings: [],
    };
    if (idempotencyCompositeKey) {
      await ingestRuntime.completeIdempotentRequest(idempotencyCompositeKey, requestFingerprint, body, 501);
    }
    return c.json(body, 501);
  }

  const items: StructuredIngestInput[] = request.items.map((item) => ({
    confidence: item.confidence,
    fields: item.fields,
    kind: item.kind,
    source: item.source,
    warnings: item.warnings,
  }));

  const result = await ingestService.ingest(request.userId, {
    mode: "structured",
    dryRun: request.dryRun,
    items,
  });

  const warnings = request.idempotencyKey
    ? [...result.warnings, "Idempotency key received but deduplication is not implemented yet."]
    : result.warnings;

  const body = {
    ...result,
    warnings: request.idempotencyKey
      ? [...result.warnings, "Idempotency key accepted and cached for replay."]
      : result.warnings,
  };

  if (idempotencyCompositeKey) {
    await ingestRuntime.completeIdempotentRequest(idempotencyCompositeKey, requestFingerprint, body, 200);
  }

  return c.json(body);
});

// Create entry:  POST /api/goals
app.post("/api/:kind{goals|practices|matches|diets|exercises}", async (c) => {
  const viewer = c.get("viewer");
  requireAuth(viewer);

  const kind = depluralize(c.req.param("kind"));
  if (!isValidKind(kind)) {
    throw new Error("Unknown entry type.");
  }

  const body = await c.req.parseBody();
  const result = await ingestService.ingest(viewer.authUser.id, {
    mode: "structured",
    items: [{ kind, fields: body, source: "manual" }],
  });
  if (!result.accepted) {
    throw new Error(result.errors[0]?.message || "Invalid entry payload.");
  }

  // After create, redirect to home so URL and view both return to "/"
  c.header("HX-Redirect", "/");
  return c.html("");
});

// Update entry:  PATCH /api/goals/:id
app.patch("/api/:kind{goals|practices|matches|diets|exercises}/:id", async (c) => {
  const viewer = c.get("viewer");
  requireAuth(viewer);

  const plural = c.req.param("kind");
  const id = c.req.param("id");
  const kind = depluralize(plural);
  const update = updaters[kind];
  if (!update) { throw new Error("Unknown entry type."); }

  const body = await c.req.parseBody();
  await update(viewer.authUser.id, id, body as Record<string, unknown>);

  // Return updated entry detail
  const item = await getEntryById(viewer.authUser.id, kind, id);
  if (!item) {
    const { items, total } = await listHistory(viewer.authUser.id, "all", 15, 0);
    return c.html(entryLauncher() + historySection(items, total, "all"));
  }
  return c.html(entryDetail(item));
});

// Delete entry:  DELETE /api/goals/:id
app.delete("/api/:kind{goals|practices|matches|diets|exercises}/:id", async (c) => {
  const viewer = c.get("viewer");
  requireAuth(viewer);

  const plural = c.req.param("kind");
  const id = c.req.param("id");
  const kind = depluralize(plural);
  const del = deleters[kind];
  if (!del) { throw new Error("Unknown entry type."); }

  await del(viewer.authUser.id, id);

  // Return redirect header for full-page navigation after delete
  c.header("HX-Redirect", "/");
  return c.html("");
});

// Profile update:  POST /api/profile
app.post("/api/profile", async (c) => {
  const viewer = c.get("viewer");
  requireAuth(viewer);

  const body = await c.req.parseBody();
  const profile = await updateTennisProfile(viewer.authUser.id, body as Record<string, unknown>);
  const nextViewer = toViewer(viewer.authUser, profile);

  // If profile was just completed and we're on a profile-required page, redirect home
  if (!nextViewer.profileRequired && viewer.profileRequired) {
    c.header("HX-Redirect", "/");
    return c.html("");
  }

  return c.html(profileForm(nextViewer));
});

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

app.on(["GET", "POST", "OPTIONS"], "/api/auth/*", async (c) => {
  if (!authConfigured) {
    return c.json({ error: "Neon Auth is not configured." }, 503);
  }
  const path = c.req.path.replace(/^\/api\/auth\//, "");
  return proxyAuthRequest(c.req.raw, path);
});

app.post("/auth/sign-up", async (c) => {
  if (!authConfigured) {
    setFlash(c, "Auth is not configured. Set NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET.");
    return c.redirect("/");
  }

  const body = await c.req.parseBody();
  const response = await authJson(c.req.raw, "/sign-up/email", {
    method: "POST",
    body: JSON.stringify({
      name: String(body.name ?? ""),
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
      callbackURL: `${env.APP_URL}/auth/callback?redirectTo=/`,
    }),
  });

  const headers = new Headers({ location: response.ok ? "/" : "/sign-in" });
  setAuthCookies(response, headers);
  const responseText = await response.text();
  const responseMessage = extractAuthMessage(responseText);

  if (!response.ok) {
    setFlashHeader(headers, responseMessage || "Sign-up failed. Check your credentials.");
  } else {
    setFlashHeader(headers, "Account created.");
  }

  return new Response(null, { status: 303, headers });
});

app.post("/auth/sign-in", async (c) => {
  if (!authConfigured) {
    setFlash(c, "Auth is not configured.");
    return c.redirect("/");
  }

  const body = await c.req.parseBody();
  const response = await authJson(c.req.raw, "/sign-in/email", {
    method: "POST",
    body: JSON.stringify({
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
    }),
  });

  const headers = new Headers({ location: response.ok ? "/" : "/sign-in" });
  setAuthCookies(response, headers);
  const responseText = await response.text();
  const responseMessage = extractAuthMessage(responseText);

  if (!response.ok) {
    setFlashHeader(headers, responseMessage || "Sign-in failed. Check your credentials.");
  }

  return new Response(null, { status: 303, headers });
});

app.post("/auth/sign-out", async (c) => {
  if (authConfigured) {
    const response = await authJson(c.req.raw, "/sign-out", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const headers = new Headers({ location: "/" });
    setAuthCookies(response, headers);
    clearAuthCookies(headers);
    return new Response(null, { status: 303, headers });
  }
  return c.redirect("/");
});

app.get("/auth/callback", async (c) => {
  return c.redirect(String(c.req.query("redirectTo") ?? "/"));
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

app.onError((error, c) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  if (c.req.header("hx-request")) {
    return c.html(`<div class="flash">${message}</div>`, 500);
  }
  setFlash(c as AppContext, message);
  return c.redirect("/");
});

// ---------------------------------------------------------------------------
// Export & serve
// ---------------------------------------------------------------------------

export default app;

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

let server: ServerType | undefined;

if (isDirectRun && !process.env.VERCEL) {
  server = serve({
    fetch: app.fetch,
    port: env.PORT,
  });
  console.log(`Tennis Zero (Six Alpha) running on http://localhost:${env.PORT}`);
}

export { server };
