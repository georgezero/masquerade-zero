import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import {
  createDiet,
  createExercise,
  createGoal,
  createMatch,
  createPractice,
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
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { journalSubmissionCandidates, journalSubmissionEntries, journalSubmissions } from "./db/schema.js";
import { IngestService } from "./ingest/service.js";
import { parseFreeformJournalToStructuredItems } from "./ingest/freeform.js";
import { extractJournalCandidatesLLM } from "./ingest/llm.js";
import { PostgresIngestRuntime } from "./ingest/runtime.js";
import { ingestApiRequestSchema } from "./ingest/schemas.js";
import type { IngestItem, IngestResult, IngestValidationError, StructuredIngestInput } from "./ingest/types.js";
import { authConfigured, env, ingestApiConfigured, ingestApiKeys, journalLlmConfigured, journalLlmEnabled, journalLlmTestPreviewEnabled, type IngestApiKeyRecord } from "./env.js";
import { authJson, getAuthSession, proxyAuthRequest, setAuthCookies } from "./lib/auth.js";
import { escapeHtml } from "./lib/html.js";
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

function sanitizeRedirectTo(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return fallback;
  }
  return trimmed;
}

function inputValue(value: unknown) {
  return escapeHtml(String(value ?? ""));
}

function journalTagClassForKind(kind: string) {
  switch (kind) {
    case "goal":
      return "rounded-full border border-cyan-200/80 bg-cyan-400/25 px-2 py-1 text-xs font-bold uppercase tracking-wide text-cyan-50 shadow-[0_0_12px_rgba(34,211,238,0.4)]";
    case "practice":
      return "rounded-full border border-indigo-200/80 bg-indigo-400/25 px-2 py-1 text-xs font-bold uppercase tracking-wide text-indigo-50 shadow-[0_0_12px_rgba(99,102,241,0.4)]";
    case "match":
      return "rounded-full border border-lime-200/80 bg-lime-400/25 px-2 py-1 text-xs font-bold uppercase tracking-wide text-lime-50 shadow-[0_0_12px_rgba(163,230,53,0.4)]";
    case "diet":
      return "rounded-full border border-amber-200/80 bg-amber-400/25 px-2 py-1 text-xs font-bold uppercase tracking-wide text-amber-50 shadow-[0_0_12px_rgba(251,191,36,0.4)]";
    case "exercise":
      return "rounded-full border border-fuchsia-200/80 bg-fuchsia-400/25 px-2 py-1 text-xs font-bold uppercase tracking-wide text-fuchsia-50 shadow-[0_0_12px_rgba(232,121,249,0.4)]";
    default:
      return "rounded-full border border-cyan-300/40 bg-cyan-500/15 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-cyan-100";
  }
}

function journalErrorHtml(message: string) {
  return `<section class="glass mx-auto mt-3 w-full max-w-[24.5rem] rounded-2xl border border-rose-300/30 bg-rose-500/10 p-4 text-sm text-rose-100 sm:max-w-3xl">${escapeHtml(message)}</section>`;
}

function getJournalModelOptions() {
  const models = [env.JOURNAL_LLM_MODEL, env.JOURNAL_LLM_SECONDARY_MODEL, env.JOURNAL_LLM_TERTIARY_MODEL]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(models));
}

function resolveJournalSelectedModel(requested?: string) {
  const available = getJournalModelOptions();
  const normalized = requested?.trim() ?? "";
  if (normalized && available.includes(normalized)) {
    return normalized;
  }
  return available[0] ?? "";
}

function renderJournalLlmControls(params?: { compareModels?: boolean; finalized?: boolean; selectedModel?: string }) {
  const compareModels = Boolean(params?.compareModels);
  const finalized = Boolean(params?.finalized);
  const selectedModel = params?.selectedModel ?? resolveJournalSelectedModel();
  const modelOptions = getJournalModelOptions();
  const disabledAttr = finalized ? " disabled" : "";

  if (!journalLlmEnabled) {
    return `<section class="rounded-xl border border-amber-300/20 bg-amber-500/10 p-3 text-xs text-amber-100">LLM extraction is disabled or not configured. Preview will use deterministic parser fallback.</section>`;
  }

  return `
    <section class="rounded-xl border border-cyan-300/20 bg-slate-900/40 p-3">
      <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label class="grid gap-1 text-sm font-medium text-slate-300">Model
          <select id="journal-model-select" name="journalModel"${disabledAttr} class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2">
            ${modelOptions.map((model) => `<option value="${escapeHtml(model)}"${model === selectedModel ? " selected" : ""}>${escapeHtml(model)}</option>`).join("")}
          </select>
        </label>
        <label class="inline-flex items-center gap-2 text-sm font-medium text-slate-300">
          <input id="journal-compare-models" type="checkbox" name="compareModels" value="true"${compareModels ? " checked" : ""}${disabledAttr} class="h-4 w-4 rounded border-slate-500 bg-slate-800" />
          Compare models
        </label>
      </div>
      <p class="mt-2 text-xs text-slate-400">Use "Compare models" to see latency and candidate stats for both configured models while previewing with the selected model.</p>
    </section>
  `;
}

let lastIngestCleanupAt = 0;

function logIngestEvent(event: string, details: Record<string, unknown>) {
  console.info("[ingest]", JSON.stringify({ event, ...details }));
}

type JournalStatus = "draft" | "finalized";

type JournalDraft = {
  id: string;
  rawText: string;
  status: JournalStatus;
};

const journalCreators = {
  diet: createDiet,
  exercise: createExercise,
  goal: createGoal,
  match: createMatch,
  practice: createPractice,
} as const;

async function getLatestDraftJournal(userId: string): Promise<JournalDraft | null> {
  if (!db) {
    return null;
  }
  const rows = await db
    .select({
      id: journalSubmissions.id,
      rawText: journalSubmissions.rawText,
      status: journalSubmissions.status,
    })
    .from(journalSubmissions)
    .where(eq(journalSubmissions.userId, userId))
    .orderBy(desc(journalSubmissions.updatedAt))
    .limit(1);

  if (!rows[0]) {
    return null;
  }
  if (rows[0].status !== "draft") {
    return null;
  }
  return {
    id: rows[0].id,
    rawText: rows[0].rawText,
    status: rows[0].status as JournalStatus,
  };
}

async function getJournalById(userId: string, journalId: string): Promise<JournalDraft | null> {
  if (!db) {
    return null;
  }
  const rows = await db
    .select({
      id: journalSubmissions.id,
      rawText: journalSubmissions.rawText,
      status: journalSubmissions.status,
    })
    .from(journalSubmissions)
    .where(and(eq(journalSubmissions.id, journalId), eq(journalSubmissions.userId, userId)))
    .limit(1);
  if (!rows[0]) {
    return null;
  }
  return {
    id: rows[0].id,
    rawText: rows[0].rawText,
    status: rows[0].status as JournalStatus,
  };
}

async function upsertDraftJournal(userId: string, text: string, journalId?: string): Promise<JournalDraft> {
  if (!db) {
    throw new Error("Database is not configured.");
  }

  if (journalId) {
    const existing = await getJournalById(userId, journalId);
    if (existing && existing.status === "draft") {
      const updated = await db
        .update(journalSubmissions)
        .set({ rawText: text, updatedAt: new Date() })
        .where(and(eq(journalSubmissions.id, journalId), eq(journalSubmissions.userId, userId)))
        .returning({ id: journalSubmissions.id, rawText: journalSubmissions.rawText, status: journalSubmissions.status });
      if (updated[0]) {
        await db.delete(journalSubmissionCandidates).where(eq(journalSubmissionCandidates.journalId, updated[0].id));
        return { id: updated[0].id, rawText: updated[0].rawText, status: updated[0].status as JournalStatus };
      }
    }
  }

  const inserted = await db
    .insert(journalSubmissions)
    .values({ userId, rawText: text, status: "draft", updatedAt: new Date() })
    .returning({ id: journalSubmissions.id, rawText: journalSubmissions.rawText, status: journalSubmissions.status });

  if (!inserted[0]) {
    throw new Error("Could not create journal draft.");
  }
  return { id: inserted[0].id, rawText: inserted[0].rawText, status: inserted[0].status as JournalStatus };
}

async function finalizeJournal(userId: string, journalId: string): Promise<JournalDraft> {
  if (!db) {
    throw new Error("Database is not configured.");
  }
  const rows = await db
    .update(journalSubmissions)
    .set({ status: "finalized", updatedAt: new Date() })
    .where(and(eq(journalSubmissions.id, journalId), eq(journalSubmissions.userId, userId)))
    .returning({ id: journalSubmissions.id, rawText: journalSubmissions.rawText, status: journalSubmissions.status });
  if (!rows[0]) {
    throw new Error("Journal not found.");
  }
  return { id: rows[0].id, rawText: rows[0].rawText, status: rows[0].status as JournalStatus };
}

function journalShell(options?: { compareModels?: boolean; journalId?: string; rawText?: string; finalized?: boolean; selectedModel?: string }) {
  const journalId = options?.journalId ?? "";
  const rawText = options?.rawText ?? "";
  const finalized = Boolean(options?.finalized);
  const compareModels = Boolean(options?.compareModels);
  const selectedModel = options?.selectedModel ?? resolveJournalSelectedModel();
  const readOnlyAttrs = finalized ? " readonly disabled" : "";
  const readOnlyClass = finalized ? " opacity-60 cursor-not-allowed bg-slate-800/80 border-slate-500/40" : "";
  const parseButton = finalized
    ? `<button id="journal-preview-button" type="button" class="rounded-xl border border-slate-500/40 bg-slate-700/40 px-4 py-2 text-sm font-semibold text-slate-300" disabled>Journal Finalized</button>`
    : `<button id="journal-preview-button" type="submit" data-submitting-text="Parsing..." class="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-400">Preview Candidates</button>`;
  const journalPlaceholder = `Today’s session with my coach Jelena was focused on..

Off court I kept things simple with a short walk, a mobility routine, and extra hydration because my legs felt heavy. I put on a mellow instrumental playlist while stretching and then made a quick bowl with rice, salmon, and vegetables before calling it a night.`;
  const resetButton = finalized
    ? `<button id="journal-reset-button" type="button" hx-post="/api/journal/edit" hx-target="#main-content" hx-swap="innerHTML" class="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">New Journal</button>`
    : "";

  return `
    <section class="glass mx-auto w-full max-w-[24.5rem] rounded-2xl border border-cyan-300/20 p-4 shadow-neon sm:max-w-3xl sm:p-5">
      <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-xs uppercase tracking-[0.28em] text-cyan-300/80">Journal</p>
          <h2 class="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Journal</h2>
          <p class="mt-1 text-sm text-slate-300">Write your journal entry and incorporate goals, practices, matches, diet, and exercises. For semicolon-delimited lines, field names are optional and can be inferred by order.</p>
        </div>
        <a href="/" class="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">Home</a>
      </div>
      <form hx-post="/api/journal/preview" hx-target="#journal-preview" hx-swap="innerHTML" class="grid gap-3">
        <textarea id="journal-textarea" name="text" rows="8"${readOnlyAttrs} placeholder="${escapeHtml(journalPlaceholder)}" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2${readOnlyClass}">${escapeHtml(rawText)}</textarea>
        <input id="journal-id-input" type="hidden" name="journalId" value="${escapeHtml(journalId)}" />
        <div id="journal-llm-controls">${renderJournalLlmControls({ selectedModel, compareModels, finalized })}</div>
        <div class="flex flex-wrap items-center gap-3">
          ${parseButton}
          ${resetButton}
          <p class="form-status min-h-5 text-sm font-medium text-emerald-300"></p>
        </div>
      </form>
    </section>
    <section id="journal-feedback" class="mx-auto w-full max-w-[24.5rem] sm:max-w-3xl"></section>
    <section id="journal-preview" class="mx-auto w-full max-w-[24.5rem] sm:max-w-3xl"></section>
  `;
}

function renderJournalStateOob(journal: JournalDraft) {
  const finalized = journal.status === "finalized";
  const readOnlyAttrs = finalized ? " readonly disabled" : "";
  const readOnlyClass = finalized ? " opacity-60 cursor-not-allowed bg-slate-800/80 border-slate-500/40" : "";
  const journalPlaceholder = `Today’s session with my coach Jelena was focused on..

Off court I kept things simple with a short walk, a mobility routine, and extra hydration because my legs felt heavy. I put on a mellow instrumental playlist while stretching and then made a quick bowl with rice, salmon, and vegetables before calling it a night.`;
  const previewButton = finalized
    ? `<button id="journal-preview-button" type="button" class="rounded-xl border border-slate-500/40 bg-slate-700/40 px-4 py-2 text-sm font-semibold text-slate-300" disabled hx-swap-oob="true">Journal Finalized</button>`
    : `<button id="journal-preview-button" type="submit" data-submitting-text="Parsing..." class="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-400" hx-swap-oob="true">Preview Candidates</button>`;
  const resetButton = finalized
    ? `<button id="journal-reset-button" type="button" hx-post="/api/journal/edit" hx-target="#main-content" hx-swap="innerHTML" class="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10" hx-swap-oob="true">New Journal</button>`
    : `<button id="journal-reset-button" type="button" class="hidden" hx-swap-oob="true" aria-hidden="true"></button>`;

  return `
    <textarea id="journal-textarea" name="text" rows="8"${readOnlyAttrs} placeholder="${escapeHtml(journalPlaceholder)}" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2${readOnlyClass}" hx-swap-oob="true">${escapeHtml(journal.rawText)}</textarea>
    <input id="journal-id-input" type="hidden" name="journalId" value="${escapeHtml(journal.id)}" hx-swap-oob="true" />
    <div id="journal-llm-controls" hx-swap-oob="outerHTML:#journal-llm-controls">${renderJournalLlmControls({ finalized })}</div>
    ${previewButton}
    ${resetButton}
  `;
}

function renderJournalFeedbackOob(message: string) {
  return `<div hx-swap-oob="afterbegin:#journal-feedback"><section class="glass mx-auto mt-3 w-full max-w-[24.5rem] rounded-2xl border border-emerald-300/30 bg-emerald-500/10 p-4 text-sm text-emerald-100 sm:max-w-3xl">${escapeHtml(message)}</section></div>`;
}

function renderJournalControls(journalId: string, finalized: boolean) {
  if (finalized) {
    return `<section id="journal-preview-controls" class="glass mx-auto mb-3 w-full max-w-[24.5rem] rounded-2xl border border-slate-500/30 bg-slate-700/20 p-4 text-sm text-slate-200 sm:max-w-3xl"><strong>Journal finalized.</strong> New Journal to start a new journal draft.</section>`;
  }
  return `<section id="journal-preview-controls" class="glass mx-auto mb-3 w-full max-w-[24.5rem] rounded-2xl border border-cyan-300/20 p-4 sm:max-w-3xl"><div class="flex flex-wrap items-center justify-between gap-2"><div><p class="text-xs uppercase tracking-wide text-cyan-300/80">Journal ID</p><p class="text-sm text-slate-200">${escapeHtml(journalId)}</p></div><button type="button" hx-post="/api/journal/finalize" hx-target="#journal-preview" hx-swap="innerHTML" hx-vals='{"journalId":"${escapeHtml(journalId)}"}' class="rounded-xl border border-cyan-300/35 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/20">Finalize</button></div></section>`;
}

function renderJournalControlsOob(journalId: string, finalized: boolean) {
  return `<div hx-swap-oob="outerHTML:#journal-preview-controls">${renderJournalControls(journalId, finalized)}</div>`;
}

function selectJournalFields(kind: (typeof VALID_KINDS)[number], body: Record<string, unknown>): Record<string, unknown> {
  if (kind === "goal") {
    return { weekStart: body.weekStart, planText: body.planText };
  }
  if (kind === "practice") {
    return {
      date: body.date,
      workedOn: body.workedOn,
      withCoach: body.withCoach,
      coachName: body.coachName,
      notes: body.notes,
    };
  }
  if (kind === "match") {
    return {
      date: body.date,
      opponent: body.opponent,
      score: body.score,
      notes: body.notes,
    };
  }
  if (kind === "diet") {
    return { date: body.date, summary: body.summary };
  }
  return {
    date: body.date,
    durationMin: body.durationMin,
    exerciseType: body.exerciseType,
    notes: body.notes,
  };
}

function renderJournalCandidateFields(item: IngestItem) {
  const fields = item.fields as Record<string, unknown>;
  if (item.kind === "goal") {
    return `
      <input type="hidden" name="weekStart" value="${inputValue(fields.weekStart)}" />
      <label class="grid gap-1 text-sm font-medium text-slate-300">Plan text
        <textarea name="planText" rows="4" required class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2">${inputValue(fields.planText)}</textarea>
      </label>
    `;
  }
  if (item.kind === "practice") {
    const withCoach = fields.withCoach ? " checked" : "";
    return `
      <label class="grid gap-1 text-sm font-medium text-slate-300">Date <input type="date" name="date" value="${inputValue(fields.date)}" required class="w-full rounded-xl border border-blue-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-blue-400 focus:ring-2" /></label>
      <label class="inline-flex items-center gap-2 text-sm font-medium text-slate-300"><input type="checkbox" name="withCoach" value="true"${withCoach} class="h-4 w-4 rounded border-slate-500 bg-slate-800" /> Session with coach</label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Coach name <input type="text" name="coachName" value="${inputValue(fields.coachName)}" class="w-full rounded-xl border border-blue-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-blue-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Worked on <textarea name="workedOn" rows="3" required class="w-full rounded-xl border border-blue-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-blue-400 focus:ring-2">${inputValue(fields.workedOn)}</textarea></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Notes <textarea name="notes" rows="3" class="w-full rounded-xl border border-blue-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-blue-400 focus:ring-2">${inputValue(fields.notes)}</textarea></label>
    `;
  }
  if (item.kind === "match") {
    return `
      <label class="grid gap-1 text-sm font-medium text-slate-300">Date <input type="date" name="date" value="${inputValue(fields.date)}" required class="w-full rounded-xl border border-emerald-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Opponent <input type="text" name="opponent" value="${inputValue(fields.opponent)}" required class="w-full rounded-xl border border-emerald-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Score <input type="text" name="score" value="${inputValue(fields.score)}" class="w-full rounded-xl border border-emerald-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Notes <textarea name="notes" rows="3" class="w-full rounded-xl border border-emerald-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400 focus:ring-2">${inputValue(fields.notes)}</textarea></label>
    `;
  }
  if (item.kind === "diet") {
    return `
      <label class="grid gap-1 text-sm font-medium text-slate-300">Date <input type="date" name="date" value="${inputValue(fields.date)}" required class="w-full rounded-xl border border-amber-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-amber-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Summary <textarea name="summary" rows="4" required class="w-full rounded-xl border border-amber-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-amber-400 focus:ring-2">${inputValue(fields.summary)}</textarea></label>
    `;
  }

  const exerciseType = String(fields.exerciseType ?? "Other");
  return `
    <label class="grid gap-1 text-sm font-medium text-slate-300">Date <input type="date" name="date" value="${inputValue(fields.date)}" required class="w-full rounded-xl border border-violet-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-violet-400 focus:ring-2" /></label>
    <label class="grid gap-1 text-sm font-medium text-slate-300">Type
      <select name="exerciseType" class="w-full rounded-xl border border-violet-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-violet-400 focus:ring-2">
        ${["Strength", "Cardio", "Mobility", "Recovery", "Other"].map((type) => `<option${type === exerciseType ? " selected" : ""}>${type}</option>`).join("")}
      </select>
    </label>
    <label class="grid gap-1 text-sm font-medium text-slate-300">Duration (min) <input type="number" name="durationMin" min="1" value="${inputValue(fields.durationMin)}" required class="w-full rounded-xl border border-violet-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-violet-400 focus:ring-2" /></label>
    <label class="grid gap-1 text-sm font-medium text-slate-300">Notes <textarea name="notes" rows="3" class="w-full rounded-xl border border-violet-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-violet-400 focus:ring-2">${inputValue(fields.notes)}</textarea></label>
  `;
}

type JournalModelComparison = {
  candidateCount: number;
  durationMs: number;
  error?: string;
  model: string;
};

function renderJournalPreview(params: {
  candidates: IngestItem[];
  compareResults?: JournalModelComparison[];
  errors: IngestValidationError[];
  finalized?: boolean;
  journalId: string;
  rawText?: string;
  selectedModel?: string;
}) {
  const { journalId, candidates, errors, finalized, rawText, compareResults = [], selectedModel } = params;
  if (candidates.length === 0 && errors.length === 0) {
    return `<section class="glass mx-auto mt-4 w-full max-w-[24.5rem] rounded-2xl border border-amber-300/20 p-4 text-sm text-amber-100 sm:max-w-3xl">No candidate entries found. Use one entry per line, for example: <code>goal: Keep first serve above 60%</code>.</section>`;
  }

  const controls = renderJournalControls(journalId, Boolean(finalized));
  const compareHtml = compareResults.length > 0
    ? `<section class="glass mx-auto mb-3 w-full max-w-[24.5rem] rounded-2xl border border-cyan-300/20 bg-slate-900/40 p-4 text-sm text-slate-200 sm:max-w-3xl">
      <p class="text-xs uppercase tracking-wide text-cyan-300/80">Model Compare</p>
      <div class="mt-2 grid gap-2 sm:grid-cols-2">${compareResults
        .map((result) => `<article class="rounded-xl border ${result.model === selectedModel ? "border-cyan-300/35 bg-cyan-500/10" : "border-slate-500/30 bg-slate-800/40"} p-3">
          <p class="text-xs text-slate-400">${result.model === selectedModel ? "Selected model" : "Alternate model"}</p>
          <p class="mt-1 text-sm font-semibold text-slate-100">${escapeHtml(result.model)}</p>
          <p class="mt-1 text-xs text-slate-300">Latency: ${result.durationMs}ms</p>
          <p class="text-xs text-slate-300">Candidates: ${result.candidateCount}</p>
          <p class="text-xs ${result.error ? "text-rose-200" : "text-emerald-200"}">${escapeHtml(result.error ? `Error: ${result.error}` : "Validated successfully")}</p>
        </article>`)
        .join("")}</div>
    </section>`
    : "";

  const errorHtml = errors.length > 0
    ? `<section class="glass mx-auto mb-3 w-full max-w-[24.5rem] rounded-2xl border border-rose-300/30 bg-rose-500/10 p-4 text-sm text-rose-100 sm:max-w-3xl"><p class="font-semibold">Some lines could not be parsed/validated:</p><ul class="mt-2 grid gap-1">${errors.map((error) => `<li>• ${escapeHtml(error.message)}</li>`).join("")}</ul></section>`
    : "";

  const cards = candidates
    .map((candidate, index) => {
      const previewId = `journal-${index}-${candidate.kind}`;
      const warnings = candidate.warnings.length > 0
        ? `<div class="rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">${candidate.warnings.map((warning) => escapeHtml(warning)).join(" ")}</div>`
        : "";

      return `
        <section id="journal-item-${previewId}" class="glass mx-auto mt-3 w-full max-w-[24.5rem] rounded-2xl border border-cyan-300/20 p-4 shadow-neon sm:max-w-3xl sm:p-5">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span class="${journalTagClassForKind(candidate.kind)}">${escapeHtml(candidate.kind)}</span>
            <span class="text-xs text-slate-400">Confidence ${(candidate.confidence * 100).toFixed(0)}%</span>
          </div>
          ${warnings}
          <form hx-post="/api/journal/confirm" hx-target="#journal-item-${previewId}" hx-swap="outerHTML" class="mt-3 grid gap-3">
            <input type="hidden" name="kind" value="${escapeHtml(candidate.kind)}" />
            <input type="hidden" name="journalId" value="${escapeHtml(journalId)}" />
            <input type="hidden" name="candidateIndex" value="${index}" />
            ${renderJournalCandidateFields(candidate)}
            <div class="flex flex-wrap items-center gap-2">
              <button type="submit" data-submitting-text="Saving..." class="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-400">Confirm & Save</button>
              <button type="button" hx-post="/api/journal/dismiss" hx-target="#journal-item-${previewId}" hx-swap="outerHTML" hx-vals='{"journalId":"${escapeHtml(journalId)}","candidateIndex":"${index}"}' class="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">Dismiss</button>
            </div>
            <p class="form-status min-h-5 text-sm font-medium text-emerald-300"></p>
          </form>
        </section>
      `;
    })
    .join("");

  const oob = finalized && typeof rawText === "string"
    ? renderJournalStateOob({ id: journalId, rawText, status: "finalized" })
    : `<input id="journal-id-input" type="hidden" name="journalId" value="${escapeHtml(journalId)}" hx-swap-oob="true" />`;

  return `${oob}${controls}${compareHtml}${errorHtml}${cards}`;
}

async function computeJournalPreviewCandidates(params: {
  compareModels: boolean;
  journalLogId: string;
  selectedModel: string;
  text: string;
  userId: string;
}): Promise<{
  compareResults: JournalModelComparison[];
  items: StructuredIngestInput[];
  result: IngestResult;
  usedFallback: boolean;
}> {
  const { compareModels, journalLogId, selectedModel, text, userId } = params;
  const fallbackWarning = "Deterministic parser fallback used. Please review candidates before saving.";
  const applyFallbackWarning = (itemsToUpdate: StructuredIngestInput[]): StructuredIngestInput[] =>
    itemsToUpdate.map((item) => {
      const currentWarnings = Array.isArray(item.warnings)
        ? item.warnings.filter((warning): warning is string => typeof warning === "string")
        : [];
      if (currentWarnings.includes(fallbackWarning)) {
        return item;
      }
      return {
        ...item,
        warnings: [...currentWarnings, fallbackWarning],
      };
    });

  const runValidation = async (structuredItems: StructuredIngestInput[]) =>
    ingestService.ingest(userId, {
      mode: "structured",
      dryRun: true,
      items: structuredItems,
    });

  const runModelAttempt = async (model: string): Promise<{
    durationMs: number;
    error?: string;
    model: string;
    result?: IngestResult;
  }> => {
    const startedAt = Date.now();
    try {
      const llmItems = await extractJournalCandidatesLLM(text, { model });
      const result = await runValidation(llmItems);
      const durationMs = Date.now() - startedAt;
      if (!result.accepted) {
        return {
          model,
          durationMs,
          error: `Schema validation failed (${result.errors.length} errors)`,
          result,
        };
      }
      return { model, durationMs, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown LLM extraction error.";
      return { model, durationMs: Date.now() - startedAt, error: message };
    }
  };

  let usedFallback = false;
  let compareResults: JournalModelComparison[] = [];
  let items: StructuredIngestInput[];
  let result: IngestResult;
  if (journalLlmEnabled && selectedModel) {
    const primaryAttempt = await runModelAttempt(selectedModel);
    if (compareModels) {
      const compareModelsList = getJournalModelOptions().filter((model) => model !== selectedModel);
      const alternateAttempts = await Promise.all(compareModelsList.map((model) => runModelAttempt(model)));
      compareResults = [primaryAttempt, ...alternateAttempts].map((attempt) => ({
        model: attempt.model,
        durationMs: attempt.durationMs,
        candidateCount: attempt.result?.candidates.length ?? 0,
        error: attempt.error,
      }));
    }

    if (primaryAttempt.result?.accepted) {
      items = primaryAttempt.result.candidates;
      result = primaryAttempt.result;
      logIngestEvent("journal_llm_extract_success", {
        journalId: journalLogId,
        model: selectedModel,
        provider: env.JOURNAL_LLM_PROVIDER,
        candidateCount: result.candidates.length,
      });
    } else {
      usedFallback = true;
      logIngestEvent("journal_llm_extract_failure", {
        journalId: journalLogId,
        model: selectedModel,
        provider: env.JOURNAL_LLM_PROVIDER,
        reason: primaryAttempt.error ?? "LLM output failed schema validation.",
      });
      items = applyFallbackWarning(parseFreeformJournalToStructuredItems(text));
      result = await runValidation(items);
    }
  } else {
    usedFallback = true;
    if (env.JOURNAL_LLM_ENABLED && !journalLlmConfigured) {
      logIngestEvent("journal_llm_extract_failure", {
        journalId: journalLogId,
        provider: env.JOURNAL_LLM_PROVIDER,
        reason: "JOURNAL_LLM_ENABLED is true but config is incomplete.",
      });
    }
    items = applyFallbackWarning(parseFreeformJournalToStructuredItems(text));
    result = await runValidation(items);
  }

  if (usedFallback) {
    logIngestEvent("journal_llm_fallback_used", {
      journalId: journalLogId,
      candidateCount: result.candidates.length,
      validationErrorCount: result.errors.length,
    });
  }

  return { items, result, usedFallback, compareResults };
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
  const redirectTo = sanitizeRedirectTo(c.req.query("redirectTo"), "/");
  return c.html(page({ viewer, route: "sign-in", flash: getFlash(c), bodyContent: authPanel(viewer, true, redirectTo) }));
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

// Journal ingestion page
app.get("/journal", async (c) => {
  const viewer = c.get("viewer");
  if (viewer.role === "guest" || !viewer.authUser) {
    setFlash(c, "Sign in required.");
    return c.redirect(`/sign-in?redirectTo=${encodeURIComponent("/journal")}`);
  }
  c.header("Cache-Control", "no-store");
  const draft = await getLatestDraftJournal(viewer.authUser.id);
  return c.html(page({
    viewer,
    route: "journal",
    flash: getFlash(c),
    bodyContent: journalShell({
      journalId: draft?.id,
      rawText: draft?.rawText,
      finalized: draft?.status === "finalized",
    }),
  }));
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

// Journal preview parser (HTMX fragment target: #journal-preview)
app.post("/api/journal/preview", async (c) => {
  const viewer = c.get("viewer");
  requireAuth(viewer);

  const body = await c.req.parseBody();
  const text = String(body.text ?? "").trim();
  const requestedJournalId = String(body.journalId ?? "").trim() || undefined;
  const requestedModel = String(body.journalModel ?? "").trim();
  const compareModels = ["1", "on", "true", "yes"].includes(String(body.compareModels ?? "").trim().toLowerCase());
  const selectedModel = resolveJournalSelectedModel(requestedModel);
  if (!text) {
    return c.html(`<section class="glass mx-auto mt-4 w-full max-w-[24.5rem] rounded-2xl border border-amber-300/20 p-4 text-sm text-amber-100 sm:max-w-3xl">Enter journal text before previewing.</section>`);
  }

  const journal = await upsertDraftJournal(viewer.authUser.id, text, requestedJournalId);
  const { items, result, compareResults } = await computeJournalPreviewCandidates({
    compareModels,
    journalLogId: journal.id,
    selectedModel,
    text,
    userId: viewer.authUser.id,
  });

  if (items.length === 0) {
    return c.html(renderJournalPreview({ journalId: journal.id, candidates: [], errors: [], selectedModel, compareResults }));
  }

  if (db) {
    for (const [index, candidate] of result.candidates.entries()) {
      await db
        .insert(journalSubmissionCandidates)
        .values({
          journalId: journal.id,
          candidateIndex: index,
          kind: candidate.kind,
          confidence: Math.round(candidate.confidence * 100),
          payloadJson: JSON.stringify(candidate),
          status: "pending",
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [journalSubmissionCandidates.journalId, journalSubmissionCandidates.candidateIndex],
          set: {
            kind: candidate.kind,
            confidence: Math.round(candidate.confidence * 100),
            payloadJson: JSON.stringify(candidate),
            status: "pending",
            updatedAt: new Date(),
          },
        });
    }
  }

  return c.html(renderJournalPreview({ journalId: journal.id, candidates: result.candidates, errors: result.errors, selectedModel, compareResults }));
});

// Journal preview test API (JSON, no session cookie). Intended for local/dev automation.
app.post("/api/journal/preview-test", async (c) => {
  if (!journalLlmTestPreviewEnabled) {
    return c.json({ error: "JOURNAL_LLM_TEST_PREVIEW_KEY is not configured." }, 503);
  }

  const providedKey = c.req.header("x-journal-test-key")?.trim() ?? "";
  if (!providedKey || providedKey !== env.JOURNAL_LLM_TEST_PREVIEW_KEY) {
    return c.json({ error: "Unauthorized." }, 401);
  }

  const contentType = c.req.header("content-type") ?? "";
  const rawBody: Record<string, unknown> = contentType.includes("application/json")
    ? await c.req.json<Record<string, unknown>>().catch(() => ({}))
    : await c.req.parseBody() as Record<string, unknown>;

  const text = String(rawBody.text ?? "").trim();
  const requestedModel = String(rawBody.journalModel ?? "").trim();
  const compareModels = ["1", "on", "true", "yes"].includes(String(rawBody.compareModels ?? "").trim().toLowerCase());
  const selectedModel = resolveJournalSelectedModel(requestedModel);

  if (!text) {
    return c.json({ error: "text is required." }, 400);
  }

  const computed = await computeJournalPreviewCandidates({
    compareModels,
    journalLogId: "preview-test",
    selectedModel,
    text,
    userId: "preview-test-user",
  });

  return c.json({
    candidates: computed.result.candidates,
    compareResults: computed.compareResults,
    errors: computed.result.errors,
    selectedModel,
    usedFallback: computed.usedFallback,
    warnings: computed.result.warnings,
  });
});

// Journal edit/reset starts a new draft shell
app.post("/api/journal/edit", async (c) => {
  const viewer = c.get("viewer");
  requireAuth(viewer);

  return c.html(journalShell());
});

// Journal finalize action
app.post("/api/journal/finalize", async (c) => {
  const viewer = c.get("viewer");
  requireAuth(viewer);
  const body = await c.req.parseBody();
  const journalId = String(body.journalId ?? "").trim();
  if (!journalId) {
    return c.html(journalErrorHtml("journalId is required."), 400);
  }
  try {
    await finalizeJournal(viewer.authUser.id, journalId);
  } catch {
    return c.html(journalErrorHtml("Journal not found."), 404);
  }

  const rows = await db
    ?.select({
      payloadJson: journalSubmissionCandidates.payloadJson,
    })
    .from(journalSubmissionCandidates)
    .where(eq(journalSubmissionCandidates.journalId, journalId))
    .orderBy(journalSubmissionCandidates.candidateIndex);

  const candidates: IngestItem[] = (rows ?? []).map((row) => JSON.parse(row.payloadJson) as IngestItem);
  const journal = await getJournalById(viewer.authUser.id, journalId);
  return c.html(renderJournalPreview({ journalId, candidates, errors: [], finalized: true, rawText: journal?.rawText ?? "" }));
});

// Journal candidate confirm/save
app.post("/api/journal/confirm", async (c) => {
  const viewer = c.get("viewer");
  requireAuth(viewer);

  const body = await c.req.parseBody() as Record<string, unknown>;
  const journalId = String(body.journalId ?? "").trim();
  const candidateIndexRaw = Number(body.candidateIndex ?? "");
  const kind = String(body.kind ?? "").trim();
  if (!journalId) {
    return c.html(journalErrorHtml("journalId is required."), 400);
  }
  if (!isValidKind(kind)) {
    return c.html(journalErrorHtml("Unknown entry type."), 400);
  }
  const fields = selectJournalFields(kind, body);

  const validated = await ingestService.ingest(viewer.authUser.id, {
    mode: "structured",
    dryRun: true,
    items: [{ kind, fields, source: "journal-ai" }],
  });
  if (!validated.accepted || validated.candidates.length === 0) {
    return c.html(journalErrorHtml(validated.errors[0]?.message || "Invalid journal candidate."), 400);
  }

  const journal = await getJournalById(viewer.authUser.id, journalId);
  if (!journal) {
    return c.html(journalErrorHtml("Journal not found."), 404);
  }
  let finalizedJournal = journal;
  if (journal.status !== "finalized") {
    finalizedJournal = await finalizeJournal(viewer.authUser.id, journalId);
  }

  const created = await journalCreators[kind](viewer.authUser.id, validated.candidates[0]!.fields as Record<string, unknown>);
  const entryId = typeof created === "object" && created && "id" in created ? String((created as { id: unknown }).id) : "";
  if (!entryId) {
    return c.html(journalErrorHtml("Could not determine created entry id."), 500);
  }

  if (db) {
    await db.insert(journalSubmissionEntries).values({
      journalId,
      candidateIndex: Number.isFinite(candidateIndexRaw) ? candidateIndexRaw : null,
      kind,
      entryId,
    });

    if (Number.isFinite(candidateIndexRaw)) {
      await db
        .update(journalSubmissionCandidates)
        .set({ status: "saved", updatedAt: new Date() })
        .where(and(eq(journalSubmissionCandidates.journalId, journalId), eq(journalSubmissionCandidates.candidateIndex, candidateIndexRaw)));
    }
  }

  return c.html(`${renderJournalStateOob(finalizedJournal)}${renderJournalControlsOob(journalId, true)}${renderJournalFeedbackOob(`Saved ${kind} entry from journal ${journalId}.`)}<div class="hidden"></div>`);
});

// Journal candidate dismiss (no save)
app.post("/api/journal/dismiss", async (c) => {
  const viewer = c.get("viewer");
  requireAuth(viewer);

  const body = await c.req.parseBody();
  const journalId = String(body.journalId ?? "").trim();
  const candidateIndex = Number(body.candidateIndex ?? "");
  if (!journalId || !Number.isFinite(candidateIndex)) {
    return c.html(journalErrorHtml("journalId and candidateIndex are required."), 400);
  }

  const journal = await getJournalById(viewer.authUser.id, journalId);
  if (!journal) {
    return c.html(journalErrorHtml("Journal not found."), 404);
  }

  if (db) {
    await db
      .update(journalSubmissionCandidates)
      .set({ status: "dismissed", updatedAt: new Date() })
      .where(and(eq(journalSubmissionCandidates.journalId, journalId), eq(journalSubmissionCandidates.candidateIndex, candidateIndex)));
  }

  return c.html(`${renderJournalFeedbackOob(`Dismissed candidate ${candidateIndex + 1} from journal ${journalId}.`)}<div class="hidden"></div>`);
});

// Ingestion API: POST /api/ingest
app.post("/api/ingest", async (c) => {
  const nowMs = Date.now();
  if (nowMs - lastIngestCleanupAt >= env.INGEST_CLEANUP_INTERVAL_MS) {
    lastIngestCleanupAt = nowMs;
    try {
      await ingestRuntime.cleanupExpiredData(nowMs);
    } catch (error) {
      logIngestEvent("cleanup_error", { message: error instanceof Error ? error.message : "unknown" });
    }
  }

  const contentLength = Number(c.req.header("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 100_000) {
    logIngestEvent("request_rejected", { reason: "payload_too_large", contentLength });
    return c.json({ error: "Request body too large." }, 413);
  }

  if (!ingestApiConfigured) {
    logIngestEvent("request_rejected", { reason: "not_configured" });
    return c.json({ error: "Ingest API is not configured." }, 503);
  }

  const providedApiKey = ingestApiAuthKey(c as AppContext);
  const resolvedApiKey = resolveIngestApiKey(providedApiKey);
  if (!resolvedApiKey) {
    logIngestEvent("auth_failed", { reason: "invalid_api_key" });
    return c.json({ error: "Unauthorized." }, 401);
  }

  let requestBody: unknown;
  try {
    requestBody = await c.req.json();
  } catch {
    logIngestEvent("request_rejected", { reason: "invalid_json", apiKeyId: resolvedApiKey.id });
    return c.json({ error: "Request body must be valid JSON." }, 400);
  }

  const parsed = ingestApiRequestSchema.safeParse(requestBody);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid ingest request.";
    logIngestEvent("request_rejected", { reason: "invalid_contract", apiKeyId: resolvedApiKey.id, message });
    return c.json({ error: message }, 400);
  }

  const request = parsed.data;
  if (Array.isArray(resolvedApiKey.allowedUserIds) && !resolvedApiKey.allowedUserIds.includes(request.userId)) {
    logIngestEvent("request_rejected", { reason: "user_forbidden", apiKeyId: resolvedApiKey.id, userId: request.userId });
    return c.json({ error: "Forbidden for requested userId." }, 403);
  }

  if (request.mode === "structured") {
    const needsWrite = !request.dryRun;
    const permitted = needsWrite
      ? keyHasAnyScope(resolvedApiKey, ["ingest:write"])
      : keyHasAnyScope(resolvedApiKey, ["ingest:dryrun", "ingest:write"]);
    if (!permitted) {
      logIngestEvent("request_rejected", {
        reason: "missing_scope",
        apiKeyId: resolvedApiKey.id,
        requiredScope: needsWrite ? "ingest:write" : "ingest:dryrun",
      });
      return c.json({ error: needsWrite ? "Missing scope: ingest:write." : "Missing scope: ingest:dryrun." }, 403);
    }
  } else if (!keyHasAnyScope(resolvedApiKey, ["ingest:dryrun", "ingest:write"])) {
    logIngestEvent("request_rejected", { reason: "missing_scope", apiKeyId: resolvedApiKey.id, requiredScope: "ingest:dryrun" });
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
      logIngestEvent("idempotency_replay", { apiKeyId: resolvedApiKey.id, userId: request.userId });
      return new Response(JSON.stringify(idemStatus.responseBody), {
        status: idemStatus.statusCode,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    if (idemStatus.state === "in_flight") {
      logIngestEvent("request_rejected", { reason: "idempotency_in_flight", apiKeyId: resolvedApiKey.id, userId: request.userId });
      return c.json({ error: "Request with this idempotency key is already in progress." }, 409);
    }
    if (idemStatus.state === "conflict") {
      logIngestEvent("request_rejected", { reason: "idempotency_conflict", apiKeyId: resolvedApiKey.id, userId: request.userId });
      return c.json({ error: "Idempotency key already used with a different payload." }, 409);
    }
  }

  const rateLimit = await ingestRuntime.checkRateLimit(clientKey);
  if (!rateLimit.allowed) {
    c.header("Retry-After", String(rateLimit.retryAfterSec));
    logIngestEvent("request_rejected", { reason: "rate_limited", apiKeyId: resolvedApiKey.id, userId: request.userId });
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
    logIngestEvent("request_completed", { mode: request.mode, status: 501, apiKeyId: resolvedApiKey.id, userId: request.userId });
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

  logIngestEvent("request_completed", {
    mode: request.mode,
    status: 200,
    apiKeyId: resolvedApiKey.id,
    userId: request.userId,
    accepted: result.accepted,
    candidateCount: result.candidates.length,
    errorCount: result.errors.length,
    createdCount: result.created.length,
  });

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
  const redirectTo = sanitizeRedirectTo(body.redirectTo, "/");
  const response = await authJson(c.req.raw, "/sign-up/email", {
    method: "POST",
    body: JSON.stringify({
      name: String(body.name ?? ""),
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
      callbackURL: `${env.APP_URL}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`,
    }),
  });

  const headers = new Headers({ location: response.ok ? redirectTo : `/sign-in?redirectTo=${encodeURIComponent(redirectTo)}` });
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
  const redirectTo = sanitizeRedirectTo(body.redirectTo, "/");
  const response = await authJson(c.req.raw, "/sign-in/email", {
    method: "POST",
    body: JSON.stringify({
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
    }),
  });

  const headers = new Headers({ location: response.ok ? redirectTo : `/sign-in?redirectTo=${encodeURIComponent(redirectTo)}` });
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
