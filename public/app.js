/* ── Tennis Zero (Six Alpha) — Client JS ──────────────────────── */

const STORAGE_KEY = "tennis-zero-six-alpha-v1";
const JOURNAL_DEV_MODEL_STORAGE_KEY = "tennis-zero-six-alpha-journal-dev-model-v1";
const JOURNAL_DEV_ENTRIES_MODEL_STORAGE_KEY = "tennis-zero-six-alpha-journal-dev-entries-model-v1";
const JOURNAL_DEV_SENTIMENT_MODEL_STORAGE_KEY = "tennis-zero-six-alpha-journal-dev-sentiment-model-v1";
const HISTORY_PAGE_SIZE = 15;
const VALID_KINDS = ["goal", "practice", "match", "diet", "exercise"];

const route = document.body?.dataset.route || "home";
const isDemo = route === "demo";
const isGuest = document.body?.dataset.authMode === "guest";

// ── Utilities ────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function today() {
  return new Date().toISOString().split("T")[0];
}

function monday(dateString) {
  const d = new Date(dateString);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return d.toISOString().split("T")[0];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function isoDate(n) {
  return daysAgo(n).toISOString().split("T")[0];
}

function isoTime(n, hour = 12) {
  const d = daysAgo(n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || "");
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function fmt(v) {
  return v === null || v === undefined || v === "" ? "None" : String(v);
}

// ── HTMX Event Handlers (authenticated mode) ────────────────────

function initHtmxHandlers() {
  document.body.addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const submitButton = target?.closest?.('button[type="submit"]');
    if (!(submitButton instanceof HTMLButtonElement)) return;
    const form = submitButton.closest("form");
    if (!(form instanceof HTMLFormElement)) return;
    form._lastSubmitButton = submitButton;
  });

  // Form locking: disable controls while HTMX request is in flight
  document.body.addEventListener("htmx:beforeRequest", (event) => {
    const form = event.target.closest?.("form");
    if (!form) return;
    const btn =
      (event.detail?.requestConfig?.elt instanceof HTMLButtonElement && event.detail.requestConfig.elt.type === "submit"
        ? event.detail.requestConfig.elt
        : null) ||
      form._lastSubmitButton ||
      form.querySelector('button[type="submit"]');
    if (btn) {
      btn._originalText = btn.textContent;
      btn._originalClassName = btn.className;
      btn._originalStyle = btn.getAttribute("style") || "";
      btn.textContent = btn.dataset.submittingText || "Saving...";
      if (btn.dataset.parseButton === "true") {
        btn.classList.remove("bg-cyan-500", "hover:bg-cyan-400");
        btn.classList.add("bg-amber-500", "hover:bg-amber-400");
        btn.style.backgroundColor = "rgb(245 158 11)";
        btn.style.borderColor = "rgb(252 211 77 / 0.65)";
        btn.style.color = "rgb(2 6 23)";
        btn.style.opacity = "1";
      }
      btn.classList.add("is-submitting");
      btn.setAttribute("aria-busy", "true");
    }
  });

  document.body.addEventListener("htmx:afterRequest", (event) => {
    const form = event.target.closest?.("form");
    if (!form) return;
    const btn = form._lastSubmitButton || form.querySelector('button[type="submit"]');
    if (btn && btn._originalText) {
      btn.textContent = btn._originalText;
      delete btn._originalText;
    }
    if (btn && btn._originalClassName) {
      btn.className = btn._originalClassName;
      delete btn._originalClassName;
    }
    if (btn && typeof btn._originalStyle === "string") {
      if (btn._originalStyle) {
        btn.setAttribute("style", btn._originalStyle);
      } else {
        btn.removeAttribute("style");
      }
      delete btn._originalStyle;
    }
    if (btn) {
      btn.classList.remove("is-submitting");
      btn.removeAttribute("aria-busy");
    }
    delete form._lastSubmitButton;
  });

  // After HTMX swap, re-bind avatar preview if profile form was swapped in
  document.body.addEventListener("htmx:afterSwap", () => {
    bindAvatarPreview();
    bindJournalDevModelPreference();
  });
}

function initCopyButtons() {
  document.addEventListener("click", async (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const button = target?.closest?.("button[data-copy-target]");
    if (!(button instanceof HTMLButtonElement)) return;

    const targetId = button.dataset.copyTarget || "";
    if (!targetId) return;
    const source = document.getElementById(targetId);
    if (!source) return;

    const text = source.textContent || "";
    if (!text.trim()) return;

    const label = button.querySelector("span");
    const previousLabel = label?.textContent || "Copy";
    try {
      await navigator.clipboard.writeText(text);
      if (label) label.textContent = "Copied";
      window.setTimeout(() => {
        if (label) label.textContent = previousLabel;
      }, 1500);
    } catch {
      if (label) label.textContent = "Failed";
      window.setTimeout(() => {
        if (label) label.textContent = previousLabel;
      }, 1500);
    }
  });
}

function bindJournalDevModelPreference() {
  if (route !== "journal-dev") return;

  const uiModeInput = document.getElementById("journal-ui-mode-input");
  if (!(uiModeInput instanceof HTMLInputElement)) return;
  if ((uiModeInput.value || "").trim().toLowerCase() !== "dev") return;

  const entriesSelect = document.getElementById("journal-model-select-entries");
  if (entriesSelect instanceof HTMLSelectElement) {
    const storedEntriesModel =
      localStorage.getItem(JOURNAL_DEV_ENTRIES_MODEL_STORAGE_KEY) ||
      localStorage.getItem(JOURNAL_DEV_MODEL_STORAGE_KEY);
    if (storedEntriesModel && Array.from(entriesSelect.options).some((option) => option.value === storedEntriesModel)) {
      entriesSelect.value = storedEntriesModel;
    }
    if (entriesSelect.dataset.modelPrefBound !== "1") {
      entriesSelect.dataset.modelPrefBound = "1";
      entriesSelect.addEventListener("change", () => {
        localStorage.setItem(JOURNAL_DEV_ENTRIES_MODEL_STORAGE_KEY, entriesSelect.value);
      });
    }
  }

  const sentimentSelect = document.getElementById("journal-model-select-sentiment");
  if (sentimentSelect instanceof HTMLSelectElement) {
    const storedSentimentModel =
      localStorage.getItem(JOURNAL_DEV_SENTIMENT_MODEL_STORAGE_KEY) ||
      localStorage.getItem(JOURNAL_DEV_ENTRIES_MODEL_STORAGE_KEY) ||
      localStorage.getItem(JOURNAL_DEV_MODEL_STORAGE_KEY);
    if (storedSentimentModel && Array.from(sentimentSelect.options).some((option) => option.value === storedSentimentModel)) {
      sentimentSelect.value = storedSentimentModel;
    }
    if (sentimentSelect.dataset.modelPrefBound !== "1") {
      sentimentSelect.dataset.modelPrefBound = "1";
      sentimentSelect.addEventListener("change", () => {
        localStorage.setItem(JOURNAL_DEV_SENTIMENT_MODEL_STORAGE_KEY, sentimentSelect.value);
      });
    }
  }
}

// ── Avatar Preview (for profile form) ────────────────────────────

function bindAvatarPreview() {
  const input = document.querySelector('input[name="avatarUrl"]');
  if (!(input instanceof HTMLInputElement)) return;

  const image = document.getElementById("profile-avatar-image");
  const fallback = document.getElementById("profile-avatar-fallback");

  // Also bind header avatar load/error
  const headerImage = document.getElementById("header-avatar-image");
  const headerFallback = document.getElementById("header-avatar-fallback");
  if (headerImage instanceof HTMLImageElement && headerFallback) {
    headerImage.addEventListener("load", () => {
      headerImage.classList.remove("hidden");
      headerFallback.classList.add("hidden");
    });
    headerImage.addEventListener("error", () => {
      headerImage.classList.add("hidden");
      headerFallback.classList.remove("hidden");
    });
  }

  if (!(image instanceof HTMLImageElement) || !fallback) return;

  image.addEventListener("load", () => {
    image.classList.remove("hidden");
    fallback.classList.add("hidden");
  });
  image.addEventListener("error", () => {
    image.classList.add("hidden");
    fallback.classList.remove("hidden");
  });
}

// ── Auth Panel Toggle (guest mode) ───────────────────────────────

function initAuthToggle() {
  document.addEventListener("click", (e) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!target) return;

    // "Sign in" button opens the auth form and hides demo content
    const signinOpen = target.closest("#signin-open");
    if (signinOpen) {
      e.preventDefault();
      const authPanel = document.getElementById("auth-panel");
      if (!authPanel) {
        window.location.href = "/sign-in";
        return;
      }
      const shell = document.getElementById("auth-form-shell");
      const cancelBtn = document.getElementById("auth-cancel-btn");
      const demoContent = document.getElementById("demo-content");
      if (authPanel) authPanel.classList.remove("hidden");
      if (shell) shell.classList.remove("hidden");
      if (cancelBtn) cancelBtn.classList.remove("hidden");
      if (demoContent) demoContent.classList.add("hidden");
      signinOpen.classList.add("hidden");
      if (authPanel) {
        const header = document.querySelector(".topbar");
        const headerHeight = header instanceof HTMLElement ? header.offsetHeight : 0;
        const top = authPanel.getBoundingClientRect().top + window.scrollY - headerHeight - 10;
        window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      }
      return;
    }

    // Cancel hides the auth form and restores demo view
    const cancelOpen = target.closest("#auth-cancel-btn");
    if (cancelOpen) {
      const shell = document.getElementById("auth-form-shell");
      const openBtn = document.getElementById("signin-open");
      const demoContent = document.getElementById("demo-content");
      if (!demoContent) {
        window.location.href = "/";
        return;
      }
      if (shell) shell.classList.add("hidden");
      if (demoContent) demoContent.classList.remove("hidden");
      cancelOpen.classList.add("hidden");
      if (openBtn) openBtn.classList.remove("hidden");
      // If on a demo sub-page, hide the auth panel again
      if (isGuestHome && window.location.pathname !== "/") {
        const authPanel = document.getElementById("auth-panel");
        if (authPanel) authPanel.classList.add("hidden");
      }
      return;
    }

    // Toggle between sign-in and sign-up mode
    if (target.id === "auth-mode-signin" || target.id === "auth-mode-signup") {
      const isSignUp = target.id === "auth-mode-signup";
      const signinBtn = document.getElementById("auth-mode-signin");
      const signupBtn = document.getElementById("auth-mode-signup");
      const nameField = document.getElementById("auth-signup-name");
      const submitBtn = document.getElementById("auth-submit-btn");
      const modeInput = document.getElementById("auth-mode-input");
      const form = document.getElementById("auth-form");
      const title = document.getElementById("auth-title");

      if (signinBtn) {
        signinBtn.className = isSignUp
          ? "rounded-xl border border-white/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300"
          : "rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-cyan-100";
      }
      if (signupBtn) {
        signupBtn.className = isSignUp
          ? "rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-cyan-100"
          : "rounded-xl border border-white/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300";
      }
      if (nameField) nameField.classList.toggle("hidden", !isSignUp);
      if (submitBtn) submitBtn.textContent = isSignUp ? "Create account" : "Sign in";
      if (modeInput instanceof HTMLInputElement) modeInput.value = isSignUp ? "signup" : "signin";
      if (form instanceof HTMLFormElement) form.action = isSignUp ? "/auth/sign-up" : "/auth/sign-in";
      if (title) title.textContent = isSignUp ? "Create Account" : "Sign In";
    }
  });
}

// ── Demo Mode: localStorage CRUD ─────────────────────────────────

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { goals: [], practices: [], matches: [], diets: [], exercises: [] };
    const p = JSON.parse(raw);
    return {
      goals: p.goals || [],
      practices: p.practices || [],
      matches: p.matches || [],
      diets: p.diets || [],
      exercises: p.exercises || [],
    };
  } catch {
    return { goals: [], practices: [], matches: [], diets: [], exercises: [] };
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function seedIfNeeded() {
  const data = loadData();

  const fakeGoals = [
    { weekStart: isoDate(0), planText: "George Zero: serve targets (50 first serves each side), cross-court backhand depth, 20-minute footwork ladder.", createdAt: isoTime(0, 9), updatedAt: isoTime(0, 9) },
    { weekStart: isoDate(7), planText: "Forehand inside-out repetition, transition volleys, tie-break focus drill.", createdAt: isoTime(7, 9), updatedAt: isoTime(7, 9) },
    { weekStart: isoDate(14), planText: "Return consistency against pace, second-serve kick placement, recovery mobility.", createdAt: isoTime(14, 9), updatedAt: isoTime(14, 9) },
    { weekStart: isoDate(21), planText: "Approach-shot decision making, net point finishing, endurance baseline sets.", createdAt: isoTime(21, 9), updatedAt: isoTime(21, 9) },
    { weekStart: isoDate(28), planText: "Match simulation blocks, pressure serving at 30-40, pre-point breathing routine.", createdAt: isoTime(28, 9), updatedAt: isoTime(28, 9) },
  ];

  const fakePractices = [
    { date: isoDate(1), withCoach: true, coachName: "Coach Maya", workedOn: "Serve toss consistency and pronation timing", notes: "Best rhythm after slowing setup and holding finish", createdAt: isoTime(1, 18) },
    { date: isoDate(3), withCoach: true, coachName: "Coach Maya", workedOn: "Backhand depth and neutral ball tolerance", notes: "Improved shape; late contact under fatigue", createdAt: isoTime(3, 18) },
    { date: isoDate(5), withCoach: false, coachName: "", workedOn: "Forehand cross-court to down-the-line patterns", notes: "20-ball target drill completed 7 times", createdAt: isoTime(5, 18) },
    { date: isoDate(8), withCoach: true, coachName: "Coach Maya", workedOn: "Return positioning vs big first serve", notes: "Standing half-step back increased control", createdAt: isoTime(8, 18) },
    { date: isoDate(11), withCoach: false, coachName: "", workedOn: "Approach and first volley combinations", notes: "Need firmer split step before first volley", createdAt: isoTime(11, 18) },
  ];

  const fakeMatches = [
    { date: isoDate(2), opponent: "Carlos Alcaraz", score: "4-6 6-4 6-7", notes: "Created short balls with deep backhand cross-court; struggled closing net points.", createdAt: isoTime(2, 20) },
    { date: isoDate(4), opponent: "Jannik Sinner", score: "3-6 6-3 6-7", notes: "Return position helped on second serves; forehand errors rose under pace.", createdAt: isoTime(4, 20) },
    { date: isoDate(6), opponent: "Novak Djokovic", score: "6-4 4-6 5-7", notes: "Strong first-serve percentage early; needed better patience in long rallies.", createdAt: isoTime(6, 20) },
    { date: isoDate(9), opponent: "Alexander Zverev", score: "5-7 7-6 7-6", notes: "Won key tie-break points with body serve + first forehand combo.", createdAt: isoTime(9, 20) },
    { date: isoDate(12), opponent: "Lorenzo Musetti", score: "6-3 3-6 7-5", notes: "Backhand line change worked well; drop-shot reads were late.", createdAt: isoTime(12, 20) },
  ];

  const fakeDiets = [
    { date: isoDate(0), summary: "Oatmeal + berries breakfast, chicken/rice lunch, salmon dinner, 2.8L hydration.", createdAt: isoTime(0, 7) },
    { date: isoDate(1), summary: "Greek yogurt pre-session, turkey wrap lunch, pasta + lean beef post-session.", createdAt: isoTime(1, 7) },
    { date: isoDate(2), summary: "Eggs/toast breakfast, quinoa bowl lunch, fruit + protein shake post-match.", createdAt: isoTime(2, 7) },
    { date: isoDate(3), summary: "Higher-carb day: oats, rice, sweet potato; electrolyte tabs during training.", createdAt: isoTime(3, 7) },
    { date: isoDate(4), summary: "Balanced intake, lighter dinner, hydration target met (3.1L).", createdAt: isoTime(4, 7) },
  ];

  const fakeExercises = [
    { date: isoDate(0), exerciseType: "Mobility", durationMin: 35, notes: "Hip openers + thoracic rotation + ankle work", createdAt: isoTime(0, 6) },
    { date: isoDate(2), exerciseType: "Strength", durationMin: 50, notes: "Split squats, RDLs, anti-rotation core", createdAt: isoTime(2, 6) },
    { date: isoDate(4), exerciseType: "Cardio", durationMin: 30, notes: "Interval bike: 6 x 2min hard / 2min easy", createdAt: isoTime(4, 6) },
    { date: isoDate(7), exerciseType: "Recovery", durationMin: 40, notes: "Easy swim + foam rolling + stretch", createdAt: isoTime(7, 6) },
    { date: isoDate(10), exerciseType: "Strength", durationMin: 45, notes: "Explosive med-ball + pull + push circuit", createdAt: isoTime(10, 6) },
  ];

  const topUp = (arr, seed) => {
    if (arr.length >= 5) return arr;
    const needed = 5 - arr.length;
    return [...arr, ...seed.slice(0, needed).map((item) => ({ id: uid(), ...item }))];
  };

  const updated = {
    goals: topUp(data.goals, fakeGoals),
    practices: topUp(data.practices, fakePractices),
    matches: topUp(data.matches, fakeMatches),
    diets: topUp(data.diets, fakeDiets),
    exercises: topUp(data.exercises, fakeExercises),
  };

  const changed =
    updated.goals.length !== data.goals.length ||
    updated.practices.length !== data.practices.length ||
    updated.matches.length !== data.matches.length ||
    updated.diets.length !== data.diets.length ||
    updated.exercises.length !== data.exercises.length;

  if (changed) saveData(updated);
}

function toHistoryItem(kind, item) {
  if (kind === "goal") {
    return { ...item, kind, date: item.weekStart, sortAt: item.updatedAt || item.createdAt, summary: item.planText };
  }
  return { ...item, kind, sortAt: item.createdAt };
}

function getAllHistory(filter) {
  const data = loadData();
  const all = [
    ...data.goals.map((x) => toHistoryItem("goal", x)),
    ...data.practices.map((x) => toHistoryItem("practice", x)),
    ...data.matches.map((x) => toHistoryItem("match", x)),
    ...data.diets.map((x) => toHistoryItem("diet", x)),
    ...data.exercises.map((x) => toHistoryItem("exercise", x)),
  ].sort((a, b) => new Date(b.sortAt).getTime() - new Date(a.sortAt).getTime());

  return filter === "all" ? all : all.filter((x) => x.kind === filter);
}

function getStoredItem(kind, id) {
  const tableMap = { goal: "goals", practice: "practices", match: "matches", diet: "diets", exercise: "exercises" };
  const data = loadData();
  const table = data[tableMap[kind]];
  if (!table) return null;
  const item = table.find((x) => x.id === id);
  return item ? toHistoryItem(kind, item) : null;
}

function createLocalEntry(kind, value) {
  const tableMap = { goal: "goals", practice: "practices", match: "matches", diet: "diets", exercise: "exercises" };
  const data = loadData();
  const now = new Date().toISOString();
  data[tableMap[kind]].unshift({ id: uid(), ...value, createdAt: now, updatedAt: now });
  saveData(data);
}

function updateLocalEntry(kind, id, value) {
  const tableMap = { goal: "goals", practice: "practices", match: "matches", diet: "diets", exercise: "exercises" };
  const data = loadData();
  const table = data[tableMap[kind]];
  const index = table.findIndex((x) => x.id === id);
  if (index < 0) throw new Error("Entry not found.");
  table[index] = { ...table[index], ...value, updatedAt: new Date().toISOString() };
  saveData(data);
}

function deleteLocalEntry(kind, id) {
  const tableMap = { goal: "goals", practice: "practices", match: "matches", diet: "diets", exercise: "exercises" };
  const data = loadData();
  data[tableMap[kind]] = data[tableMap[kind]].filter((x) => x.id !== id);
  saveData(data);
}

// ── Demo Mode: Tag Classes ──────────────────────────────────────

function tagClass(kind) {
  const map = {
    goal: "rounded-full border border-cyan-200/80 bg-cyan-400/25 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-cyan-50 shadow-[0_0_12px_rgba(34,211,238,0.4)]",
    practice: "rounded-full border border-indigo-200/80 bg-indigo-400/25 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-indigo-50 shadow-[0_0_12px_rgba(99,102,241,0.4)]",
    match: "rounded-full border border-lime-200/80 bg-lime-400/25 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-lime-50 shadow-[0_0_12px_rgba(163,230,53,0.4)]",
    diet: "rounded-full border border-amber-200/80 bg-amber-400/25 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-50 shadow-[0_0_12px_rgba(251,191,36,0.4)]",
    exercise: "rounded-full border border-fuchsia-200/80 bg-fuchsia-400/25 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-fuchsia-50 shadow-[0_0_12px_rgba(232,121,249,0.4)]",
  };
  return map[kind] || "";
}

function summaryText(item) {
  if (item.kind === "goal") return item.summary || item.planText || "Weekly goals updated";
  if (item.kind === "practice") return `${item.withCoach ? "Coach" : "Solo"} practice - ${item.workedOn || ""}${item.notes ? ` - ${item.notes}` : ""}`;
  if (item.kind === "match") return `vs ${item.opponent || "?"} - ${item.score || "No score"}${item.notes ? ` - ${item.notes}` : ""}`;
  if (item.kind === "diet") return item.summary || "";
  if (item.kind === "exercise") return `${item.exerciseType || "Exercise"} - ${item.durationMin || 0} min${item.notes ? ` - ${item.notes}` : ""}`;
  return "";
}

// ── Demo Mode: Rendering ─────────────────────────────────────────

let demoFilter = "all";
let demoLimit = HISTORY_PAGE_SIZE;

function renderDemoLauncher() {
  return `
    <section id="entry-launcher" class="glass mx-auto w-full max-w-[24.5rem] rounded-2xl border border-fuchsia-300/20 p-4 shadow-magenta sm:max-w-3xl sm:p-5">
      <h2 class="text-xl font-bold tracking-tight text-white">Add Entry</h2>
      <p class="mt-1 text-sm text-slate-300">Click a button to open its form panel.</p>
      <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <a href="/demo/new/goal" class="flex min-h-12 items-center justify-center rounded-xl border border-cyan-200/80 bg-cyan-400/25 px-4 py-3 text-sm font-bold text-cyan-50 shadow-[0_0_18px_rgba(34,211,238,0.45)] transition hover:bg-cyan-400/35">Goal</a>
        <a href="/demo/new/practice" class="flex min-h-12 items-center justify-center rounded-xl border border-indigo-200/80 bg-indigo-400/25 px-4 py-3 text-sm font-bold text-indigo-50 shadow-[0_0_18px_rgba(99,102,241,0.45)] transition hover:bg-indigo-400/35">Practice</a>
        <a href="/demo/new/match" class="flex min-h-12 items-center justify-center rounded-xl border border-lime-200/80 bg-lime-400/25 px-4 py-3 text-sm font-bold text-lime-50 shadow-[0_0_18px_rgba(163,230,53,0.45)] transition hover:bg-lime-400/35">Match</a>
        <a href="/demo/new/diet" class="flex min-h-12 items-center justify-center rounded-xl border border-amber-200/80 bg-amber-400/25 px-4 py-3 text-sm font-bold text-amber-50 shadow-[0_0_18px_rgba(251,191,36,0.45)] transition hover:bg-amber-400/35">Diet</a>
        <a href="/demo/new/exercise" class="flex min-h-12 items-center justify-center rounded-xl border border-fuchsia-200/80 bg-fuchsia-400/25 px-4 py-3 text-sm font-bold text-fuchsia-50 shadow-[0_0_18px_rgba(232,121,249,0.45)] transition hover:bg-fuchsia-400/35">Exercise</a>
      </div>
    </section>
  `;
}

function renderDemoHistory() {
  const items = getAllHistory(demoFilter).slice(0, demoLimit);
  const total = getAllHistory(demoFilter).length;
  const countText = `Showing ${items.length} of ${total}`;

  return `
    <section id="feed" class="glass mx-auto w-full max-w-[24.5rem] rounded-2xl border border-cyan-300/20 p-4 shadow-neon sm:max-w-3xl sm:p-5">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-xl font-bold tracking-tight text-white sm:text-2xl">Recent Entries</h2>
        <a href="/demo/add" class="rounded-xl border border-fuchsia-200/80 bg-fuchsia-400/25 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-fuchsia-50 shadow-[0_0_18px_rgba(232,121,249,0.35)] transition hover:bg-fuchsia-400/35">Add Entry</a>
      </div>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <label for="demo-filter" class="text-xs uppercase tracking-wide text-slate-400">Category</label>
        <select id="demo-filter" class="rounded-lg border border-cyan-300/20 bg-slate-900/70 px-2.5 py-1.5 text-xs text-slate-100 outline-none ring-cyan-400 focus:ring-2">
          ${["all", "goal", "practice", "match", "diet", "exercise"]
            .map((k) => `<option value="${k}"${demoFilter === k ? " selected" : ""}>${k === "all" ? "All" : k.charAt(0).toUpperCase() + k.slice(1)}</option>`)
            .join("")}
        </select>
        <span class="text-xs text-slate-400">${escapeHtml(countText)}</span>
      </div>
      <ul id="demo-history" class="grid gap-3">
        ${items.length === 0
          ? `<p class="mt-2 text-sm text-slate-400">No entries yet.</p>`
          : items.map((item) => `
              <li class="rounded-xl border border-cyan-300/20 bg-slate-900/60 shadow-[0_0_0_1px_rgba(56,189,248,0.14),0_0_24px_rgba(59,130,246,0.12)]">
                <a href="/demo/view/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.id)}" class="block w-full rounded-xl p-3 text-left transition hover:bg-cyan-400/5">
                  <div class="mb-1 flex flex-wrap items-start justify-between gap-2 text-sm">
                    <span class="${tagClass(item.kind)}">${escapeHtml(item.kind)}</span>
                    <span class="font-mono text-[11px] text-slate-400">${escapeHtml(formatDateTime(item.sortAt))}</span>
                  </div>
                  <div class="text-sm text-slate-100">${escapeHtml(summaryText(item))}</div>
                </a>
              </li>
            `).join("")}
      </ul>
      ${items.length < total ? `<button id="demo-load-more" type="button" class="mt-3 rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-500/20">Load more</button>` : ""}
    </section>
  `;
}

function renderDemoBanner() {
  return `
    <section class="mx-auto w-full max-w-[24.5rem] rounded-2xl border border-amber-200/25 bg-[linear-gradient(155deg,rgba(120,53,15,0.35),rgba(51,65,85,0.68))] p-4 shadow-[0_0_0_1px_rgba(251,191,36,0.16),0_0_26px_rgba(245,158,11,0.12)] sm:max-w-3xl sm:p-5">
      <p class="text-xs uppercase tracking-[0.28em] text-amber-300/85">Demo Mode</p>
      <p class="mt-2 text-sm text-amber-100/80">Explore Tennis Zero with demo data</p>
      <p class="mt-3 inline-flex rounded-full border border-amber-200/25 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100/80">Local browser data only</p>
    </section>
  `;
}

function detailFields(item) {
  const fields = [];
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
  if (item.createdAt) fields.push(["Created", formatDateTime(item.createdAt)]);
  if (item.updatedAt) fields.push(["Updated", formatDateTime(item.updatedAt)]);
  return fields;
}

function renderDemoDetail(kind, id) {
  const item = getStoredItem(kind, id);
  if (!item) {
    return `<section class="glass mx-auto w-full max-w-[24.5rem] rounded-2xl border border-cyan-300/20 p-4 shadow-neon sm:max-w-3xl sm:p-5">
      <p class="text-sm text-slate-400">Entry not found.</p>
      <a href="/demo" class="mt-2 inline-block rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">Back</a>
    </section>`;
  }

  const label = kind.charAt(0).toUpperCase() + kind.slice(1);
  return `
    <section class="glass mx-auto w-full max-w-[24.5rem] rounded-2xl border border-cyan-300/20 p-4 shadow-neon sm:max-w-3xl sm:p-5">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-xs uppercase tracking-[0.28em] text-cyan-300/80">${escapeHtml(label)} Detail</p>
          <h2 class="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">${escapeHtml(label)}</h2>
          <p class="mt-1 text-sm text-slate-300">${escapeHtml(formatDateTime(item.sortAt))}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <a href="/demo/edit/${encodeURIComponent(kind)}/${encodeURIComponent(id)}" class="rounded-xl border border-cyan-200/80 bg-cyan-400/25 px-4 py-2 text-sm font-bold text-cyan-50 shadow-[0_0_18px_rgba(34,211,238,0.35)] transition hover:bg-cyan-400/35">Edit</a>
          <button id="demo-delete-btn" data-kind="${escapeHtml(kind)}" data-id="${escapeHtml(id)}" type="button" class="rounded-xl border border-rose-300/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/20">Delete</button>
          <a href="/demo" class="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">Close</a>
        </div>
      </div>
      <div class="grid gap-3">
        ${detailFields(item).map(([l, v]) => `
          <div class="rounded-2xl border border-white/10 bg-slate-950/35 p-4">
            <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">${escapeHtml(l)}</p>
            <div class="mt-2 whitespace-pre-wrap text-sm text-slate-100">${escapeHtml(v)}</div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function formFieldsForKind(kind, item) {
  const val = (key) => item ? escapeHtml(String(item[key] ?? "")) : "";
  const t = today();

  if (kind === "goal") {
    return `
      <label for="demo-plan" class="text-sm font-medium text-slate-300">Goal details</label>
      <textarea id="demo-plan" name="planText" rows="6" placeholder="Mon: Serve + footwork" class="w-full rounded-xl border border-cyan-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-cyan-400 focus:ring-2">${val("planText") || val("summary")}</textarea>
    `;
  }
  if (kind === "practice") {
    return `
      <label class="grid gap-1 text-sm font-medium text-slate-300">Date <input type="date" name="date" value="${val("date") || t}" required class="w-full rounded-xl border border-blue-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-blue-400 focus:ring-2" /></label>
      <label class="inline-flex items-center gap-2 text-sm font-medium text-slate-300"><input type="checkbox" name="withCoach" value="true"${item?.withCoach ? " checked" : ""} class="h-4 w-4 rounded border-slate-500 bg-slate-800" /> Session with coach</label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Coach name <input type="text" name="coachName" value="${val("coachName")}" class="w-full rounded-xl border border-blue-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-blue-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Worked on <textarea name="workedOn" rows="3" required class="w-full rounded-xl border border-blue-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-blue-400 focus:ring-2">${val("workedOn")}</textarea></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Notes <textarea name="notes" rows="3" class="w-full rounded-xl border border-blue-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-blue-400 focus:ring-2">${val("notes")}</textarea></label>
    `;
  }
  if (kind === "match") {
    return `
      <label class="grid gap-1 text-sm font-medium text-slate-300">Date <input type="date" name="date" value="${val("date") || t}" required class="w-full rounded-xl border border-emerald-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Opponent <input type="text" name="opponent" value="${val("opponent")}" required class="w-full rounded-xl border border-emerald-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Score <input type="text" name="score" value="${val("score")}" placeholder="6-4 3-6 10-7" class="w-full rounded-xl border border-emerald-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Notes <textarea name="notes" rows="3" class="w-full rounded-xl border border-emerald-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-400 focus:ring-2">${val("notes")}</textarea></label>
    `;
  }
  if (kind === "diet") {
    return `
      <label class="grid gap-1 text-sm font-medium text-slate-300">Date <input type="date" name="date" value="${val("date") || t}" required class="w-full rounded-xl border border-amber-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-amber-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Summary <textarea name="summary" rows="4" required class="w-full rounded-xl border border-amber-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-amber-400 focus:ring-2">${val("summary")}</textarea></label>
    `;
  }
  if (kind === "exercise") {
    const exerciseType = String(item?.exerciseType ?? "Strength");
    return `
      <label class="grid gap-1 text-sm font-medium text-slate-300">Date <input type="date" name="date" value="${val("date") || t}" required class="w-full rounded-xl border border-violet-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-violet-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Type
        <select name="exerciseType" class="w-full rounded-xl border border-violet-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-violet-400 focus:ring-2">
          ${["Strength", "Cardio", "Mobility", "Recovery", "Other"].map((t) => `<option${t === exerciseType ? " selected" : ""}>${t}</option>`).join("")}
        </select>
      </label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Duration (min) <input type="number" name="durationMin" min="1" value="${val("durationMin") || "30"}" required class="w-full rounded-xl border border-violet-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-violet-400 focus:ring-2" /></label>
      <label class="grid gap-1 text-sm font-medium text-slate-300">Notes <textarea name="notes" rows="3" class="w-full rounded-xl border border-violet-300/20 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none ring-violet-400 focus:ring-2">${val("notes")}</textarea></label>
    `;
  }
  return "";
}

function renderDemoForm(kind, item) {
  const label = kind.charAt(0).toUpperCase() + kind.slice(1);
  const isEdit = Boolean(item);
  const backUrl = isEdit ? `/demo/view/${encodeURIComponent(kind)}/${encodeURIComponent(item.id)}` : "/demo";

  return `
    <section class="glass mx-auto w-full max-w-[24.5rem] rounded-2xl border border-cyan-300/20 p-4 shadow-neon sm:max-w-3xl sm:p-5">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="text-lg font-bold text-white">${isEdit ? "Edit" : "Add"} ${escapeHtml(label)}</h3>
        <a href="${backUrl}" class="rounded-lg border border-white/20 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10">Close</a>
      </div>
      <form id="demo-entry-form" data-kind="${escapeHtml(kind)}" data-id="${isEdit ? escapeHtml(item.id) : ""}" data-mode="${isEdit ? "edit" : "create"}" class="grid gap-3">
        ${formFieldsForKind(kind, item)}
        <button type="submit" class="w-fit rounded-xl bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-400">${isEdit ? "Save" : "Add"} ${escapeHtml(label)}</button>
        <p id="demo-form-status" class="min-h-5 text-sm font-medium text-emerald-300"></p>
      </form>
    </section>
  `;
}

// ── Demo Mode: Router ────────────────────────────────────────────

function parseDemoRoute() {
  const path = window.location.pathname;

  // /demo/add
  if (path === "/demo/add") return { mode: "add" };

  // /demo/view/:kind/:id
  const viewMatch = path.match(/^\/demo\/view\/([^/]+)\/([^/]+)$/);
  if (viewMatch) return { mode: "view", kind: decodeURIComponent(viewMatch[1]), id: decodeURIComponent(viewMatch[2]) };

  // /demo/edit/:kind/:id
  const editMatch = path.match(/^\/demo\/edit\/([^/]+)\/([^/]+)$/);
  if (editMatch) return { mode: "edit", kind: decodeURIComponent(editMatch[1]), id: decodeURIComponent(editMatch[2]) };

  // /demo/new/:kind
  const newMatch = path.match(/^\/demo\/new\/([^/]+)$/);
  if (newMatch) return { mode: "new", kind: decodeURIComponent(newMatch[1]) };

  // /demo or / (guest home)
  return { mode: "list" };
}

// On the guest home page ("/"), the server renders the auth panel into #main-content.
// We keep that and append demo content into a separate container below it.
// On /demo/* pages the server renders an empty body so we write directly into #main-content.
const isGuestHome = isDemo && window.location.pathname === "/";

function getDemoContainer() {
  if (isGuestHome) {
    let container = document.getElementById("demo-content");
    if (!container) {
      const main = document.getElementById("main-content");
      if (!main) return null;
      container = document.createElement("div");
      container.id = "demo-content";
      container.className = "grid gap-4";
      main.appendChild(container);
    }
    return container;
  }
  return document.getElementById("main-content");
}

function renderDemoPage() {
  const container = getDemoContainer();
  if (!container) return;

  const route = parseDemoRoute();
  const isListView = route.mode === "list";

  // On guest home ("/"), show auth panel for list view, hide for demo sub-pages
  if (isGuestHome) {
    const authPanel = document.getElementById("auth-panel");
    if (authPanel) authPanel.classList.toggle("hidden", !isListView);
  }

  if (route.mode === "view" && route.kind && route.id) {
    container.innerHTML = renderDemoBanner() + renderDemoDetail(route.kind, route.id);
  } else if (route.mode === "edit" && route.kind && route.id) {
    const item = getStoredItem(route.kind, route.id);
    container.innerHTML = renderDemoBanner() + (item ? renderDemoForm(route.kind, item) : renderDemoDetail(route.kind, route.id));
  } else if (route.mode === "new" && route.kind && VALID_KINDS.includes(route.kind)) {
    container.innerHTML = renderDemoBanner() + renderDemoForm(route.kind);
  } else if (route.mode === "add") {
    container.innerHTML = renderDemoBanner() + renderDemoLauncher();
  } else {
    container.innerHTML = renderDemoBanner() + renderDemoHistory();
  }

  bindDemoEvents();
}

function bindDemoEvents() {
  // Filter change
  const filter = document.getElementById("demo-filter");
  if (filter instanceof HTMLSelectElement) {
    filter.addEventListener("change", () => {
      demoFilter = filter.value;
      demoLimit = HISTORY_PAGE_SIZE;
      renderDemoPage();
    });
  }

  // Load more
  const loadMore = document.getElementById("demo-load-more");
  if (loadMore) {
    loadMore.addEventListener("click", () => {
      demoLimit += HISTORY_PAGE_SIZE;
      renderDemoPage();
    });
  }

  // Delete button
  const deleteBtn = document.getElementById("demo-delete-btn");
  if (deleteBtn) {
    const runDelete = () => {
      const kind = deleteBtn.dataset.kind || deleteBtn.getAttribute("data-kind");
      const id = deleteBtn.dataset.id || deleteBtn.getAttribute("data-id");
      if (!kind || !id) return;
      if (!window.confirm("Delete this entry?")) return;
      deleteLocalEntry(kind, id);
      window.history.pushState({}, "", isGuestHome ? "/" : "/demo");
      renderDemoPage();
    };

    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      runDelete();
    });

    // iOS Safari can be inconsistent with synthetic click timing on dynamic buttons.
    deleteBtn.addEventListener("touchend", (e) => {
      e.preventDefault();
      runDelete();
    }, { passive: false });
  }

  // Form submission
  const form = document.getElementById("demo-entry-form");
  if (form instanceof HTMLFormElement) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const kind = form.dataset.kind;
      const id = form.dataset.id;
      const mode = form.dataset.mode;
      const status = document.getElementById("demo-form-status");

      try {
        let payload = {};
        if (kind === "goal") {
          const planText = (fd.get("planText") || "").toString().trim();
          if (!planText) { if (status) status.textContent = "Goal cannot be empty."; return; }
          payload = { planText, weekStart: monday(today()) };
        } else if (kind === "practice") {
          payload = {
            date: fd.get("date"),
            withCoach: fd.get("withCoach") === "true",
            coachName: (fd.get("coachName") || "").toString().trim(),
            workedOn: (fd.get("workedOn") || "").toString().trim(),
            notes: (fd.get("notes") || "").toString().trim(),
          };
        } else if (kind === "match") {
          payload = {
            date: fd.get("date"),
            opponent: (fd.get("opponent") || "").toString().trim(),
            score: (fd.get("score") || "").toString().trim(),
            notes: (fd.get("notes") || "").toString().trim(),
          };
        } else if (kind === "diet") {
          payload = {
            date: fd.get("date"),
            summary: (fd.get("summary") || "").toString().trim(),
          };
        } else if (kind === "exercise") {
          payload = {
            date: fd.get("date"),
            exerciseType: fd.get("exerciseType"),
            durationMin: Number(fd.get("durationMin") || 30),
            notes: (fd.get("notes") || "").toString().trim(),
          };
        }

        if (mode === "edit" && id) {
          updateLocalEntry(kind, id, payload);
          window.history.pushState({}, "", `/demo/view/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
        } else {
          createLocalEntry(kind, payload);
          window.history.pushState({}, "", isGuestHome ? "/" : "/demo");
        }
        renderDemoPage();
      } catch (err) {
        if (status) status.textContent = err.message || "Error saving entry.";
      }
    });
  }
}

// ── Demo Mode: Client-side Navigation ────────────────────────────

function initDemoNavigation() {
  // Intercept link clicks within demo for SPA-style navigation
  document.addEventListener("click", (e) => {
    const link = e.target.closest?.("a[href]");
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href || !href.startsWith("/demo")) return;

    e.preventDefault();
    // On guest home page, stay on "/" for list view instead of navigating to "/demo"
    if (isGuestHome && href === "/demo") {
      window.history.pushState({}, "", "/");
    } else {
      window.history.pushState({}, "", href);
    }
    renderDemoPage();
  });

  window.addEventListener("popstate", () => {
    renderDemoPage();
  });
}

// ── Init ─────────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  if (isDemo) {
    seedIfNeeded();
    initDemoNavigation();
    renderDemoPage();
    // Guest home page has auth panel alongside demo content
    if (isGuestHome) {
      initAuthToggle();
      // If auth form is already open (e.g. after failed login), hide demo and header sign-in
      const shell = document.getElementById("auth-form-shell");
      if (shell && !shell.classList.contains("hidden")) {
        const demoContent = document.getElementById("demo-content");
        const signinBtn = document.getElementById("signin-open");
        if (demoContent) demoContent.classList.add("hidden");
        if (signinBtn) signinBtn.classList.add("hidden");
      }
    }
  } else {
    initHtmxHandlers();
    initCopyButtons();
    initAuthToggle();
    bindAvatarPreview();
    bindJournalDevModelPreference();
    if (window.location.pathname === "/sign-in") {
      const signinBtn = document.getElementById("signin-open");
      if (signinBtn) signinBtn.classList.add("hidden");
    }
  }
});
