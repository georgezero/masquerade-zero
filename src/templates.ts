import type { Viewer, HistoryItem, AppProfile } from "./lib/app.js";
import { escapeHtml, formatDateTime } from "./lib/html.js";

const ASSET_VERSION = "20260316-six-alpha-026";

function avatarInitials(viewer: Viewer) {
  const first = viewer.profile?.firstName?.trim() || "";
  const last = viewer.profile?.lastName?.trim() || "";
  const nickname = viewer.profile?.tennisNickname?.trim() || "";
  const email = viewer.authUser?.email?.trim() || "";

  const fromNames = `${first.charAt(0)}${last.charAt(0)}`.trim();
  if (fromNames) {
    return escapeHtml(fromNames.toUpperCase());
  }
  if (nickname) {
    return escapeHtml(nickname.slice(0, 2).toUpperCase());
  }
  if (email) {
    return escapeHtml(email.slice(0, 2).toUpperCase());
  }
  return "P";
}

function headerActions(viewer: Viewer, route: "home" | "profile" | "view" | "edit" | "new" | "demo" | "sign-in" | "journal") {
  if (viewer.role === "guest") {
    if (route === "sign-in") {
      return "";
    }
    return `
      <div class="flex items-center gap-2">
        <a id="signin-open" href="/sign-in" class="shrink-0 whitespace-nowrap rounded-xl border border-cyan-200/80 bg-cyan-400/25 px-3 py-1.5 text-xs font-bold text-cyan-50 shadow-[0_0_18px_rgba(34,211,238,0.35)] transition hover:bg-cyan-400/35 sm:px-4 sm:py-2 sm:text-sm">Sign in</a>
      </div>
    `;
  }

  return `
    <a id="header-profile-link" href="/profile" class="shrink-0 rounded-full border border-white/10 bg-slate-900/70 p-1.5 transition hover:bg-white/10">
      <span class="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-cyan-300/25 bg-cyan-500/10 text-sm font-black text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.2)]">
        ${
          viewer.profile?.avatarUrl
            ? `<img id="header-avatar-image" src="${escapeHtml(viewer.profile.avatarUrl)}" alt="Profile avatar" class="h-full w-full object-cover" onerror="this.classList.add('hidden');this.nextElementSibling.classList.remove('hidden')" />
               <span id="header-avatar-fallback" class="hidden">${avatarInitials(viewer)}</span>`
            : `<img id="header-avatar-image" alt="Profile avatar" class="hidden h-full w-full object-cover" />
               <span id="header-avatar-fallback">${avatarInitials(viewer)}</span>`
        }
      </span>
    </a>
  `;
}

function tagClassForKind(kind: string) {
  switch (kind) {
    case "goal":
      return "rounded-full border border-cyan-200/80 bg-cyan-400/25 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-cyan-50 shadow-[0_0_12px_rgba(34,211,238,0.4)]";
    case "practice":
      return "rounded-full border border-indigo-200/80 bg-indigo-400/25 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-indigo-50 shadow-[0_0_12px_rgba(99,102,241,0.4)]";
    case "match":
      return "rounded-full border border-lime-200/80 bg-lime-400/25 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-lime-50 shadow-[0_0_12px_rgba(163,230,53,0.4)]";
    case "diet":
      return "rounded-full border border-amber-200/80 bg-amber-400/25 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-50 shadow-[0_0_12px_rgba(251,191,36,0.4)]";
    case "exercise":
      return "rounded-full border border-fuchsia-200/80 bg-fuchsia-400/25 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-fuchsia-50 shadow-[0_0_12px_rgba(232,121,249,0.4)]";
    default:
      return "rounded-full border border-cyan-300/30 bg-cyan-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-cyan-100";
  }
}

function summaryForItem(item: HistoryItem) {
  const kind = item.kind;
  if (kind === "goal") {
    return String(item.summary || item.planText || "Weekly goals updated");
  }
  if (kind === "practice") {
    return `${item.withCoach ? "Coach" : "Solo"} practice - ${item.workedOn || ""}${item.notes ? ` - ${item.notes}` : ""}`;
  }
  if (kind === "match") {
    return `vs ${item.opponent || "?"} - ${item.score || "No score"}${item.notes ? ` - ${item.notes}` : ""}`;
  }
  if (kind === "diet") {
    return String(item.summary || "");
  }
  if (kind === "exercise") {
    return `${item.exerciseType || "Exercise"} - ${item.durationMin || 0} min${item.notes ? ` - ${item.notes}` : ""}`;
  }
  return "";
}

export function historySection(items: HistoryItem[], total: number, filter: string) {
  const count = items.length;
  const countText = `Showing ${count} of ${total}`;

  return `
    <section id="feed" class="glass mx-auto w-full max-w-[24.5rem] rounded-2xl border border-cyan-300/20 p-4 shadow-neon sm:max-w-3xl sm:p-5">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-xl font-bold tracking-tight text-white sm:text-2xl">Recent Entries</h2>
        <button
          hx-get="/api/entry-launcher"
          hx-target="#main-content"
          hx-swap="innerHTML"
          type="button"
          class="rounded-xl border border-fuchsia-200/80 bg-fuchsia-400/25 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-fuchsia-50 shadow-[0_0_18px_rgba(232,121,249,0.35)] transition hover:bg-fuchsia-400/35"
        >
          Add Entry
        </button>
      </div>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <label for="history-filter" class="text-xs uppercase tracking-wide text-slate-400">Category</label>
        <select id="history-filter" class="rounded-lg border border-cyan-300/20 bg-slate-900/70 px-2.5 py-1.5 text-xs text-slate-100 outline-none ring-cyan-400 focus:ring-2"
          hx-get="/api/history" hx-target="#feed" hx-swap="outerHTML" hx-include="this" name="kind"
        >
          ${["all", "goal", "practice", "match", "diet", "exercise"]
            .map((k) => `<option value="${k}"${filter === k ? " selected" : ""}>${k === "all" ? "All" : k.charAt(0).toUpperCase() + k.slice(1)}</option>`)
            .join("")}
        </select>
        <span id="history-count" class="text-xs text-slate-400">${escapeHtml(countText)}</span>
      </div>
      <ul id="history" class="grid gap-3">
        ${
          items.length === 0
            ? `<p class="mt-2 text-sm text-slate-400">No entries yet.</p>`
            : items
                .map(
                  (item) => `
                    <li class="rounded-xl border border-cyan-300/20 bg-slate-900/60 shadow-[0_0_0_1px_rgba(56,189,248,0.14),0_0_24px_rgba(59,130,246,0.12)]">
                      <a href="/view/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.id)}" class="block w-full rounded-xl p-3 text-left transition hover:bg-cyan-400/5">
                        <div class="mb-1 flex flex-wrap items-start justify-between gap-2 text-sm">
                          <span class="${tagClassForKind(item.kind)}">${escapeHtml(item.kind)}</span>
                          <span class="font-mono text-[11px] text-slate-400">${escapeHtml(formatDateTime(item.sortAt))}</span>
                        </div>
                        <div class="text-sm text-slate-100">${escapeHtml(summaryForItem(item))}</div>
                      </a>
                    </li>
                  `,
                )
                .join("")
        }
      </ul>
      ${count < total ? `<button hx-get="/api/history?kind=${encodeURIComponent(filter)}&limit=30" hx-target="#feed" hx-swap="outerHTML" type="button" class="mt-3 rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-500/20">Load more</button>` : ""}
    </section>
  `;
}

function detailFieldsHtml(item: HistoryItem) {
  const fields: [string, string][] = [];
  const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "None" : String(v));

  if (item.kind === "goal") {
    fields.push(["Week of", fmt(item.weekStart || item.date)]);
    fields.push(["Summary", fmt(item.planText || item.summary)]);
  } else if (item.kind === "practice") {
    fields.push(["Date", fmt(item.date)]);
    fields.push(["With coach", item.withCoach ? "Yes" : "No"]);
    fields.push(["Coach name", fmt(item.coachName)]);
    fields.push(["Worked on", fmt(item.workedOn)]);
    fields.push(["Notes", fmt(item.notes)]);
  } else if (item.kind === "match") {
    fields.push(["Date", fmt(item.date)]);
    fields.push(["Opponent", fmt(item.opponent)]);
    fields.push(["Score", fmt(item.score)]);
    fields.push(["Notes", fmt(item.notes)]);
  } else if (item.kind === "diet") {
    fields.push(["Date", fmt(item.date)]);
    fields.push(["Summary", fmt(item.summary)]);
  } else if (item.kind === "exercise") {
    fields.push(["Date", fmt(item.date)]);
    fields.push(["Type", fmt(item.exerciseType)]);
    fields.push(["Duration", item.durationMin ? `${item.durationMin} min` : "None"]);
    fields.push(["Notes", fmt(item.notes)]);
  }

  if (item.createdAt) {
    fields.push(["Created", formatDateTime(String(item.createdAt))]);
  }
  if (item.updatedAt) {
    fields.push(["Updated", formatDateTime(String(item.updatedAt))]);
  }

  return fields
    .map(
      ([label, value]) => `
        <div class="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
          <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">${escapeHtml(label)}</p>
          <div class="mt-2 whitespace-pre-wrap text-sm text-slate-100">${escapeHtml(value)}</div>
        </div>
      `,
    )
    .join("");
}

export function entryDetail(item: HistoryItem) {
  const label = item.kind.charAt(0).toUpperCase() + item.kind.slice(1);
  return `
    <section id="entry-detail" class="glass mx-auto w-full max-w-[24.5rem] rounded-2xl border border-cyan-300/20 p-4 shadow-neon sm:max-w-3xl sm:p-5">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-xs uppercase tracking-[0.28em] text-cyan-300/80">${escapeHtml(label)} Detail</p>
          <h2 class="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">${escapeHtml(label)}</h2>
          <p class="mt-1 text-sm text-slate-300">${escapeHtml(formatDateTime(item.sortAt))}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <a href="/edit/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.id)}" class="rounded-xl border border-cyan-200/80 bg-cyan-400/25 px-4 py-2 text-sm font-bold text-cyan-50 shadow-[0_0_18px_rgba(34,211,238,0.35)] transition hover:bg-cyan-400/35">Edit</a>
          <button hx-delete="/api/${encodeURIComponent(item.kind)}s/${encodeURIComponent(item.id)}" hx-target="#entry-detail" hx-swap="outerHTML" hx-confirm="Delete this entry?" type="button" class="rounded-xl border border-rose-300/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/20">Delete</button>
          <a href="/" class="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">Close</a>
        </div>
      </div>
      <div class="grid gap-3">${detailFieldsHtml(item)}</div>
    </section>
  `;
}

function formFieldsForKind(kind: string, item?: HistoryItem) {
  const val = (key: string) => item ? escapeHtml(String(item[key] ?? "")) : "";
  const today = new Date().toISOString().split("T")[0];

  if (kind === "goal") {
    return `
      <label for="week-plan" class="text-sm font-medium text-slate-300">Goal details</label>
      <textarea id="week-plan" name="planText" rows="6" placeholder="Mon: Serve + footwork" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2">${val("planText") || val("summary")}</textarea>
      <input type="hidden" name="weekStart" value="${val("weekStart") || val("date") || today}" />
    `;
  }

  if (kind === "practice") {
    const checked = item?.withCoach ? " checked" : "";
    return `
      <label class="grid gap-1 text-sm font-medium text-slate-300">Date <input type="date" name="date" value="${val("date") || today}" required class="w-full rounded-xl border border-blue-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-blue-400 focus:ring-2" /></label>
      <label class="inline-flex items-center gap-2 text-sm font-medium text-slate-300"><input type="checkbox" name="withCoach" value="true"${checked} class="h-4 w-4 rounded border-slate-500 bg-slate-800" /> Session with coach</label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Coach name <input type="text" name="coachName" value="${val("coachName")}" class="w-full rounded-xl border border-blue-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-blue-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Worked on <textarea name="workedOn" rows="3" required class="w-full rounded-xl border border-blue-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-blue-400 focus:ring-2">${val("workedOn")}</textarea></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Notes <textarea name="notes" rows="3" class="w-full rounded-xl border border-blue-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-blue-400 focus:ring-2">${val("notes")}</textarea></label>
    `;
  }

  if (kind === "match") {
    return `
      <label class="grid gap-1 text-sm font-medium text-slate-300">Date <input type="date" name="date" value="${val("date") || today}" required class="w-full rounded-xl border border-emerald-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Opponent <input type="text" name="opponent" value="${val("opponent")}" required class="w-full rounded-xl border border-emerald-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Score <input type="text" name="score" value="${val("score")}" placeholder="6-4 3-6 10-7" class="w-full rounded-xl border border-emerald-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Notes <textarea name="notes" rows="3" class="w-full rounded-xl border border-emerald-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400 focus:ring-2">${val("notes")}</textarea></label>
    `;
  }

  if (kind === "diet") {
    return `
      <label class="grid gap-1 text-sm font-medium text-slate-300">Date <input type="date" name="date" value="${val("date") || today}" required class="w-full rounded-xl border border-amber-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-amber-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Summary <textarea name="summary" rows="4" required class="w-full rounded-xl border border-amber-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-amber-400 focus:ring-2">${val("summary")}</textarea></label>
    `;
  }

  if (kind === "exercise") {
    const exerciseType = String(item?.exerciseType ?? "Strength");
    return `
      <label class="grid gap-1 text-sm font-medium text-slate-300">Date <input type="date" name="date" value="${val("date") || today}" required class="w-full rounded-xl border border-violet-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-violet-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Type
        <select name="exerciseType" class="w-full rounded-xl border border-violet-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-violet-400 focus:ring-2">
          ${["Strength", "Cardio", "Mobility", "Recovery", "Other"]
            .map((t) => `<option${t === exerciseType ? " selected" : ""}>${t}</option>`)
            .join("")}
        </select>
      </label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Duration (min) <input type="number" name="durationMin" min="1" value="${val("durationMin") || "30"}" required class="w-full rounded-xl border border-violet-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-violet-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Notes <textarea name="notes" rows="3" class="w-full rounded-xl border border-violet-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-violet-400 focus:ring-2">${val("notes")}</textarea></label>
    `;
  }

  return "";
}

export function entryForm(kind: string, item?: HistoryItem) {
  const label = kind.charAt(0).toUpperCase() + kind.slice(1);
  const isEdit = Boolean(item);
  const method = isEdit ? "patch" : "post";
  const action = isEdit ? `/api/${kind}s/${item!.id}` : `/api/${kind}s`;
  const hxMethod = isEdit ? `hx-patch="${action}"` : `hx-post="${action}"`;

  return `
    <section class="glass mx-auto w-full max-w-[24.5rem] rounded-2xl border border-cyan-300/20 p-4 shadow-neon sm:max-w-3xl sm:p-5">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="text-lg font-bold text-white">${isEdit ? "Edit" : "Add"} ${escapeHtml(label)}</h3>
        <a href="${isEdit ? `/view/${encodeURIComponent(kind)}/${encodeURIComponent(item!.id)}` : "/"}" class="rounded-lg border border-white/20 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10">Close</a>
      </div>
      <form ${hxMethod} hx-target="#main-content" hx-swap="innerHTML" class="grid gap-3">
        ${formFieldsForKind(kind, item)}
        <button type="submit" data-submitting-text="${isEdit ? "Saving..." : "Adding..."}" class="w-fit rounded-xl bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-400">${isEdit ? "Save" : "Add"} ${escapeHtml(label)}</button>
        <p class="form-status min-h-5 text-sm font-medium text-emerald-300"></p>
      </form>
    </section>
  `;
}

export function entryLauncher() {
  return `
    <section id="entry-launcher" class="glass mx-auto w-full max-w-[24.5rem] rounded-2xl border border-fuchsia-300/20 p-4 shadow-magenta sm:max-w-3xl sm:p-5">
      <h2 class="text-xl font-bold tracking-tight text-white">Add Entry</h2>
      <p class="mt-1 text-sm text-slate-300">Click a button to open its form panel.</p>
      <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <a href="/new/goal" class="flex min-h-12 items-center justify-center rounded-xl border border-cyan-200/80 bg-cyan-400/25 px-4 py-3 text-sm font-bold text-cyan-50 shadow-[0_0_18px_rgba(34,211,238,0.45)] transition hover:bg-cyan-400/35">Goal</a>
        <a href="/new/practice" class="flex min-h-12 items-center justify-center rounded-xl border border-indigo-200/80 bg-indigo-400/25 px-4 py-3 text-sm font-bold text-indigo-50 shadow-[0_0_18px_rgba(99,102,241,0.45)] transition hover:bg-indigo-400/35">Practice</a>
        <a href="/new/match" class="flex min-h-12 items-center justify-center rounded-xl border border-lime-200/80 bg-lime-400/25 px-4 py-3 text-sm font-bold text-lime-50 shadow-[0_0_18px_rgba(163,230,53,0.45)] transition hover:bg-lime-400/35">Match</a>
        <a href="/new/diet" class="flex min-h-12 items-center justify-center rounded-xl border border-amber-200/80 bg-amber-400/25 px-4 py-3 text-sm font-bold text-amber-50 shadow-[0_0_18px_rgba(251,191,36,0.45)] transition hover:bg-amber-400/35">Diet</a>
        <a href="/new/exercise" class="flex min-h-12 items-center justify-center rounded-xl border border-fuchsia-200/80 bg-fuchsia-400/25 px-4 py-3 text-sm font-bold text-fuchsia-50 shadow-[0_0_18px_rgba(232,121,249,0.45)] transition hover:bg-fuchsia-400/35">Exercise</a>
      </div>
      <div class="mt-3">
        <a href="/journal" class="inline-flex min-h-11 items-center justify-center rounded-xl border border-cyan-300/35 bg-cyan-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-500/20">Journal Ingest</a>
      </div>
    </section>
  `;
}

export function authPanel(viewer: Viewer, hasFlash = false, redirectTo = "/") {
  if (viewer.role !== "guest") {
    const name =
      [viewer.profile?.firstName, viewer.profile?.lastName].filter(Boolean).join(" ") ||
      viewer.authUser?.name ||
      viewer.authUser?.email ||
      "Signed in";
    const joinedDate = viewer.profile?.createdAt
      ? formatDateTime(viewer.profile.createdAt)
      : "";

    return `
      <section class="glass mx-auto w-full max-w-[24.5rem] rounded-2xl border border-white/10 p-4 shadow-neon sm:max-w-3xl sm:p-5" id="auth-panel">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="text-xs uppercase tracking-[0.28em] text-cyan-300/80">Access</p>
            <h2 class="mt-1 text-xl font-bold tracking-tight text-white">${escapeHtml(name)}</h2>
            ${joinedDate ? `<p class="mt-1 text-sm text-slate-300">Joined ${escapeHtml(joinedDate)}</p>` : ""}
          </div>
          <div class="flex flex-wrap items-start justify-end gap-2">
            <form method="post" action="/auth/sign-out">
              <button type="submit" class="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">Sign out</button>
            </form>
            <a href="/" class="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">Home</a>
          </div>
        </div>
      </section>
    `;
  }

  return `
    <section class="glass mx-auto w-full max-w-[24.5rem] rounded-2xl border border-white/10 p-4 shadow-neon sm:max-w-3xl sm:p-5" id="auth-panel">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-[0.28em] text-cyan-300/80">Access</p>
          <h2 id="auth-title" class="mt-1 text-xl font-bold tracking-tight text-white">Sign In</h2>
          <p id="auth-subtitle" class="mt-1 min-h-5 text-sm text-slate-300"></p>
        </div>
        <div class="flex shrink-0 items-start justify-end gap-2">
          <button id="auth-cancel-btn" type="button" class="${hasFlash ? "" : "hidden "}rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">Cancel</button>
        </div>
      </div>
      <div id="auth-form-shell" class="mt-4${hasFlash ? "" : " hidden"}">
        <div class="mb-3 flex flex-wrap gap-2">
          <button id="auth-mode-signin" type="button" class="rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-cyan-100">Sign in</button>
          <button id="auth-mode-signup" type="button" class="rounded-xl border border-white/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300">Create account</button>
        </div>
        <form id="auth-form" method="post" action="/auth/sign-in" class="grid gap-3">
          <input type="hidden" name="authMode" value="signin" id="auth-mode-input" />
          <input type="hidden" name="redirectTo" value="${escapeHtml(redirectTo)}" />
          <div id="auth-signup-name" class="hidden">
            <label class="grid gap-1 text-sm font-medium text-slate-300">Name
              <input id="auth-name-input" type="text" name="name" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2" />
            </label>
          </div>
          <label class="grid gap-1 text-sm font-medium text-slate-300">Email
            <input type="email" name="email" required class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2" />
          </label>
          <label class="grid gap-1 text-sm font-medium text-slate-300">Password
            <input type="password" name="password" required minlength="8" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2" />
          </label>
          <div class="flex flex-wrap items-center gap-3">
            <button id="auth-submit-btn" type="submit" class="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-400">Sign in</button>
          </div>
          <p id="auth-form-status" class="min-h-5 text-sm font-medium text-emerald-300"></p>
        </form>
      </div>
    </section>
  `;
}

export function profileForm(viewer: Viewer) {
  const p = viewer.profile;
  const isRequired = viewer.profileRequired;
  const eyebrow = isRequired ? "Profile Required" : "Player Profile";
  const heading = isRequired ? "Complete your profile" : "Edit your profile";
  const copy = isRequired
    ? "Signed-in use requires first name, last name, and sex. Everything else is optional and editable later."
    : "Update your tennis identity, preferences, and avatar at any time.";

  return `
    <section id="profile-shell" class="glass mx-auto w-full max-w-[24.5rem] rounded-2xl border border-amber-300/20 p-4 shadow-neon sm:max-w-3xl sm:p-5">
      <div class="mb-4">
        <p class="text-xs uppercase tracking-[0.28em] text-amber-300/80">${escapeHtml(eyebrow)}</p>
        <h2 class="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">${escapeHtml(heading)}</h2>
        <p class="mt-1 text-sm text-slate-300">${escapeHtml(copy)}</p>
      </div>
      <form hx-post="/api/profile" hx-target="#profile-shell" hx-swap="outerHTML" class="grid gap-4">
        <section class="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
          <div class="mb-4">
            <p class="text-xs uppercase tracking-[0.24em] text-cyan-300/80">About You</p>
            <p class="mt-1 text-sm text-slate-300">First name, last name, and sex are required.</p>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1 text-sm font-medium text-slate-300">First name <input type="text" name="firstName" value="${escapeHtml(p?.firstName ?? "")}" required class="w-full rounded-xl border border-amber-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-amber-400 focus:ring-2" /></label>
            <label class="grid gap-1 text-sm font-medium text-slate-300">Last name <input type="text" name="lastName" value="${escapeHtml(p?.lastName ?? "")}" required class="w-full rounded-xl border border-amber-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-amber-400 focus:ring-2" /></label>
            <label class="grid gap-1 text-sm font-medium text-slate-300">Tennis nickname <input type="text" name="tennisNickname" value="${escapeHtml(p?.tennisNickname ?? "")}" class="w-full rounded-xl border border-amber-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-amber-400 focus:ring-2" /></label>
            <label class="grid gap-1 text-sm font-medium text-slate-300">Birth year <input type="number" name="birthYear" min="1900" max="2100" value="${p?.birthYear ?? ""}" class="w-full rounded-xl border border-amber-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-amber-400 focus:ring-2" /></label>
            <label class="grid gap-1 text-sm font-medium text-slate-300">Sex
              <select name="sex" required class="w-full rounded-xl border border-amber-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-amber-400 focus:ring-2">
                <option value="">Select...</option>
                ${["male", "female", "other", "prefer_not_to_say"]
                  .map((v) => `<option value="${v}"${p?.sex === v ? " selected" : ""}>${v === "prefer_not_to_say" ? "Prefer not to say" : v.charAt(0).toUpperCase() + v.slice(1)}</option>`)
                  .join("")}
              </select>
            </label>
          </div>
        </section>
        <section class="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
          <div class="mb-4">
            <p class="text-xs uppercase tracking-[0.24em] text-cyan-300/80">Tennis Profile</p>
            <p class="mt-1 text-sm text-slate-300">All tennis profile fields are optional.</p>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1 text-sm font-medium text-slate-300">Handedness
              <select name="handedness" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2">
                <option value="">Select...</option>
                ${["right", "left", "ambidextrous"]
                  .map((v) => `<option value="${v}"${p?.handedness === v ? " selected" : ""}>${v.charAt(0).toUpperCase() + v.slice(1)}${v === "right" ? "-handed" : v === "left" ? "-handed" : ""}</option>`)
                  .join("")}
              </select>
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-300">Level <input type="text" name="level" value="${escapeHtml(p?.level ?? "")}" placeholder="USTA 4.0 / UTR 7 / Intermediate" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2" /></label>
            <label class="grid gap-1 text-sm font-medium text-slate-300">Years playing <input type="number" name="yearsPlaying" min="0" max="100" value="${p?.yearsPlaying ?? ""}" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2" /></label>
            <label class="grid gap-1 text-sm font-medium text-slate-300">Singles / doubles
              <select name="singlesDoublesPreference" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2">
                <option value="">Select...</option>
                ${["singles", "doubles", "both"]
                  .map((v) => `<option value="${v}"${p?.singlesDoublesPreference === v ? " selected" : ""}>${v.charAt(0).toUpperCase() + v.slice(1)}</option>`)
                  .join("")}
              </select>
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-300">Backhand style
              <select name="backhandStyle" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2">
                <option value="">Select...</option>
                ${["one-handed", "two-handed"]
                  .map((v) => `<option value="${v}"${p?.backhandStyle === v ? " selected" : ""}>${v.charAt(0).toUpperCase() + v.slice(1)}</option>`)
                  .join("")}
              </select>
            </label>
            <label class="grid gap-1 text-sm font-medium text-slate-300 sm:col-span-2">Primary goals <textarea name="primaryGoals" rows="3" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2">${escapeHtml(p?.primaryGoals ?? "")}</textarea></label>
          </div>
        </section>
        <section class="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
          <div class="mb-4">
            <p class="text-xs uppercase tracking-[0.24em] text-cyan-300/80">Preferences</p>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1 text-sm font-medium text-slate-300">Training days <input type="text" name="trainingDays" value="${escapeHtml(p?.trainingDays ?? "")}" placeholder="Mon, Wed, Sat" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2" /></label>
            <label class="grid gap-1 text-sm font-medium text-slate-300">Coach name <input type="text" name="coachName" value="${escapeHtml(p?.coachName ?? "")}" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2" /></label>
            <label class="grid gap-1 text-sm font-medium text-slate-300">Home club <input type="text" name="homeClub" value="${escapeHtml(p?.homeClub ?? "")}" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2" /></label>
            <label class="grid gap-1 text-sm font-medium text-slate-300">Preferred session length (min) <input type="number" name="preferredSessionMinutes" min="0" max="600" value="${p?.preferredSessionMinutes ?? ""}" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2" /></label>
            <label class="grid gap-1 text-sm font-medium text-slate-300 sm:col-span-2">Injury notes <textarea name="injuryNotes" rows="3" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2">${escapeHtml(p?.injuryNotes ?? "")}</textarea></label>
            <label class="grid gap-1 text-sm font-medium text-slate-300 sm:col-span-2">Favorite drills <textarea name="favoriteDrills" rows="3" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2">${escapeHtml(p?.favoriteDrills ?? "")}</textarea></label>
          </div>
        </section>
        <section class="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
          <div class="mb-4">
            <p class="text-xs uppercase tracking-[0.24em] text-cyan-300/80">Avatar</p>
            <p class="mt-1 text-sm text-slate-300">Use an external HTTPS image URL.</p>
          </div>
          <label class="grid gap-1 text-sm font-medium text-slate-300">Avatar URL <input type="url" name="avatarUrl" value="${escapeHtml(p?.avatarUrl ?? "")}" placeholder="https://example.com/avatar.jpg" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2" /></label>
        </section>
        <div class="flex flex-wrap items-center gap-3">
          <button type="submit" data-submitting-text="Saving..." class="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-400">Save</button>
          <p class="form-status min-h-5 text-sm font-medium text-emerald-300"></p>
        </div>
      </form>
    </section>
  `;
}

export function page(params: {
  viewer: Viewer;
  route: "home" | "profile" | "view" | "edit" | "new" | "demo" | "sign-in" | "journal";
  flash?: string;
  bodyContent: string;
}) {
  const { viewer, route, flash, bodyContent } = params;
  const isProfile = route === "profile";
  const faviconHref = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%23fbbf24'/%3E%3Cstop offset='100%25' stop-color='%23ffe998'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='16' fill='%231a0a05'/%3E%3Crect x='4.5' y='4.5' width='55' height='55' rx='13' fill='%231a0a05' stroke='url(%23g)' stroke-width='1.5'/%3E%3Ctext x='50%25' y='54%25' text-anchor='middle' dominant-baseline='middle' font-family='Space Grotesk, Arial, sans-serif' font-size='26' font-weight='700' letter-spacing='1' fill='%23fff7e0'%3E6A%3C/text%3E%3C/svg%3E`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Six Alpha - Tennis Zero</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet" />
    <link rel="icon" href="${faviconHref}" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            boxShadow: {
              neon: '0 0 0 1px rgba(56,189,248,0.28), 0 0 32px rgba(59,130,246,0.26)',
              magenta: '0 0 0 1px rgba(232,121,249,0.3), 0 0 36px rgba(236,72,153,0.22)',
            },
            keyframes: {
              drift: {
                '0%,100%': { transform: 'translate3d(0,0,0)' },
                '50%': { transform: 'translate3d(16px,-20px,0)' },
              },
              pulseTap: {
                '0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(34,211,238,0.0)' },
                '35%': { transform: 'scale(0.92)', boxShadow: '0 0 0 10px rgba(34,211,238,0.18)' },
                '100%': { transform: 'scale(1.04)', boxShadow: '0 0 0 18px rgba(34,211,238,0.0)' },
              },
            },
            animation: {
              drift: 'drift 16s ease-in-out infinite',
              pulseTap: 'pulseTap 420ms cubic-bezier(0.22, 1, 0.36, 1)',
            },
          },
        },
      }
    </script>
    <script src="https://unpkg.com/htmx.org@2.0.4"></script>
    <link rel="stylesheet" href="/app.css?v=${ASSET_VERSION}" />
    <script src="/app.js?v=${ASSET_VERSION}" defer></script>
  </head>
  <body data-route="${route}" data-auth-mode="${viewer.role === "guest" ? "guest" : "signed-in"}" class="min-h-screen overflow-x-hidden text-slate-100 antialiased">
    <style>
      body {
        background:
          radial-gradient(circle at 8% 0%, rgba(14, 165, 233, 0.2), transparent 28%),
          radial-gradient(circle at 85% 5%, rgba(244, 114, 182, 0.2), transparent 24%),
          radial-gradient(circle at 35% 100%, rgba(45, 212, 191, 0.12), transparent 40%),
          #020617;
      }
      .glass {
        background: linear-gradient(160deg, rgba(15, 23, 42, 0.85), rgba(17, 24, 39, 0.74));
        backdrop-filter: blur(12px);
      }
    </style>

    <div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div class="absolute -left-24 top-16 h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl animate-drift"></div>
      <div class="absolute right-0 top-32 h-72 w-72 rounded-full bg-fuchsia-500/20 blur-3xl animate-drift"></div>
      <div class="absolute bottom-12 left-1/3 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl animate-drift"></div>
    </div>

    <header class="topbar fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-slate-950/85 backdrop-blur">
      <div class="mx-auto flex w-full max-w-6xl items-start justify-between gap-2 px-3 py-4 sm:gap-4 sm:px-6 sm:py-6">
        <div class="flex min-w-0 items-start gap-2 sm:gap-3">
          <a class="brand-lockup shrink-0" href="/">
            <div class="brand-mark">6A</div>
          </a>
          <div class="min-w-0">
            <a href="/" class="brand-name" style="text-decoration:none">Six Alpha</a>
            <h1 class="mt-1 text-xl font-black tracking-tight sm:text-4xl">
              <a href="/" class="text-white transition hover:text-cyan-200">Tennis Zero</a>
            </h1>
            <p class="mt-1 max-w-2xl truncate text-sm text-slate-300 sm:text-base">Zero in on your tennis</p>
          </div>
        </div>
        ${headerActions(viewer, route)}
      </div>
    </header>

    <main id="main-content" class="mx-auto grid w-full max-w-6xl gap-4 px-3 pb-4 pt-32 sm:px-6 sm:pb-6 sm:pt-40">
      ${flash ? `<section class="flash rounded-2xl border border-amber-300/30 bg-amber-500/10 p-4 text-sm text-amber-100">${escapeHtml(flash)}</section>` : ""}
      ${bodyContent}
    </main>
  </body>
</html>`;
}
