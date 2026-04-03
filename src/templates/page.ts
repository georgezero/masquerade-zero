import { escapeHtml } from "../lib/html.js";

const ASSET_VERSION = process.env.ASSET_VERSION ?? Date.now().toString();

export function page(opts: {
  title: string;
  body: string;
  htmx?: boolean;
}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(opts.title)} — Masquerade</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%23fbbf24'/%3E%3Cstop offset='100%25' stop-color='%23ffe998'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='16' fill='%230f172a'/%3E%3Crect x='4.5' y='4.5' width='55' height='55' rx='13' fill='%230f172a' stroke='url(%23g)' stroke-width='1.5'/%3E%3Ctext x='50%25' y='54%25' text-anchor='middle' dominant-baseline='middle' font-family='Space Grotesk, Arial, sans-serif' font-size='26' font-weight='700' letter-spacing='1' fill='%23fff7e0'%3EM?%3C/text%3E%3C/svg%3E" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk:wght@400;700&display=swap" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="/app.css?v=${ASSET_VERSION}" />
  <style>dialog::backdrop{background:rgba(0,0,0,.65)}</style>
  ${opts.htmx !== false ? `<script src="https://unpkg.com/htmx.org@1.9.12" defer></script>` : ""}
</head>
<body class="min-h-screen bg-slate-950 text-slate-100">
  ${opts.body}
</body>
</html>`;
}

export function errorPage(message: string) {
  return page({
    title: "Error",
    body: `
    <div class="flex min-h-screen items-center justify-center p-4">
      <div class="rounded-2xl border border-red-500/30 bg-red-950/40 p-8 text-center max-w-sm">
        <p class="text-red-300 font-semibold">${escapeHtml(message)}</p>
        <a href="/" class="mt-4 inline-block text-sm text-slate-400 hover:text-slate-200">← Back to home</a>
      </div>
    </div>`,
  });
}

export function flash(message: string) {
  return `<div class="flash mb-4">${escapeHtml(message)}</div>`;
}
