import { escapeHtml } from "../lib/html.js";
import { page } from "./page.js";
import type { InferSelectModel } from "drizzle-orm";
import type { schema } from "../db/index.js";

type WordPack = InferSelectModel<typeof schema.wordPacks>;
type WordPair = InferSelectModel<typeof schema.wordPairs>;

export function adminPage(packs: (WordPack & { pairs: WordPair[] })[]) {
  return page({
    title: "Admin — Word Packs",
    body: `
    <div class="max-w-2xl mx-auto p-6 space-y-8">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-black text-amber-300 font-[Space_Grotesk]">Word Packs</h1>
        <a href="/" class="text-sm text-slate-400 hover:text-slate-200">← Home</a>
      </div>

      <!-- New pack form -->
      <form method="POST" action="/admin/packs" class="rounded-xl border border-slate-700/60 bg-slate-800/30 p-4 space-y-3">
        <h2 class="text-sm font-bold uppercase tracking-widest text-slate-400">New Pack</h2>
        <div class="flex gap-2">
          <input type="text" name="name" placeholder="Subject" required
            class="flex-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none" />
          <input type="text" name="category" placeholder="Category" required
            class="w-36 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none" />
          <button type="submit"
            class="rounded-lg border border-amber-300/60 bg-amber-400/20 px-4 py-2 text-sm font-bold text-amber-100 transition hover:bg-amber-400/30">
            Add
          </button>
        </div>
      </form>

      <!-- Packs list -->
      ${packs.map((pack) => `
      <div class="rounded-xl border border-slate-700/40 bg-slate-800/20 p-4 space-y-3">
        <div class="flex items-center gap-3">
          <h2 class="font-bold text-slate-100">${escapeHtml(pack.name)}</h2>
          <span class="rounded-full border border-cyan-200/50 bg-cyan-400/10 px-2 py-0.5 text-xs font-semibold text-cyan-300">
            ${escapeHtml(pack.category)}
          </span>
          <span class="ml-auto text-xs text-slate-500">${pack.pairs.length} pairs</span>
          <form method="POST" action="/admin/packs/${escapeHtml(pack.id)}/toggle">
            <button type="submit" class="text-xs ${pack.active ? "text-green-400" : "text-slate-500"} hover:text-slate-200">
              ${pack.active ? "active" : "inactive"}
            </button>
          </form>
          <form method="POST" action="/admin/packs/${escapeHtml(pack.id)}/delete"
            onsubmit="return confirm('Delete pack and all its pairs?')">
            <button type="submit" class="text-xs text-slate-600 hover:text-red-400">Delete</button>
          </form>
        </div>

        <!-- Pairs list -->
        <div class="space-y-1.5">
          ${pack.pairs.map((pair) => `
          <div class="flex items-center gap-2 rounded-lg border border-slate-700/30 bg-slate-800/30 px-3 py-2 text-sm">
            <span class="text-slate-200 font-medium flex-1">${escapeHtml(pair.civilianWord)}</span>
            <span class="text-slate-500">→</span>
            <span class="text-slate-400 flex-1">${pair.imposterWord ? escapeHtml(pair.imposterWord) : "<em class='text-slate-600'>no word</em>"}</span>
            <form method="POST" action="/admin/packs/${escapeHtml(pack.id)}/pairs/${escapeHtml(pair.id)}/delete">
              <button type="submit" class="text-slate-600 hover:text-red-400 text-xs">✕</button>
            </form>
          </div>
          `).join("")}
        </div>

        <!-- Add pair form -->
        <form method="POST" action="/admin/packs/${escapeHtml(pack.id)}/pairs" class="flex gap-2">
          <input type="text" name="civilianWord" placeholder="Civilian word" required
            class="flex-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none" />
          <input type="text" name="imposterWord" placeholder="Imposter word (optional)"
            class="flex-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none" />
          <button type="submit"
            class="rounded-lg border border-cyan-300/40 bg-cyan-500/10 px-4 py-2 text-sm font-bold text-cyan-200 transition hover:bg-cyan-500/20">
            +
          </button>
        </form>
      </div>
      `).join("")}

      ${packs.length === 0 ? `<p class="text-center text-slate-500 text-sm py-8">No word packs yet. Create one above.</p>` : ""}
    </div>`,
  });
}
