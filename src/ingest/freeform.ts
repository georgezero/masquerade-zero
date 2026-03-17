import type { StructuredIngestInput } from "./types.js";

const JOURNAL_KIND_SET = new Set(["goal", "practice", "match", "diet", "exercise"]);

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function parseKeyValueFields(input: string): Record<string, string> {
  const pairs = input
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean);

  const fields: Record<string, string> = {};
  for (const pair of pairs) {
    const equalsIndex = pair.indexOf("=");
    const colonIndex = pair.indexOf(":");
    const dividerIndex =
      equalsIndex > 0 && (colonIndex <= 0 || equalsIndex < colonIndex)
        ? equalsIndex
        : colonIndex;
    if (dividerIndex <= 0) {
      continue;
    }
    const key = pair.slice(0, dividerIndex).trim();
    const value = pair.slice(dividerIndex + 1).trim();
    if (!key) {
      continue;
    }
    fields[key] = value;
  }
  return fields;
}

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }
  return false;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function parsePositionalFields(kind: string, payload: string): Record<string, unknown> {
  const parts = payload
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  if (kind === "goal") {
    if (parts.length >= 2) {
      return { weekStart: parts[0], planText: parts.slice(1).join("; ") };
    }
    return { weekStart: todayIsoDate(), planText: parts[0] ?? "" };
  }

  if (kind === "practice") {
    const hasDate = isIsoDate(parts[0] ?? "");
    const offset = hasDate ? 1 : 0;
    return {
      date: hasDate ? (parts[0] ?? todayIsoDate()) : todayIsoDate(),
      workedOn: parts[0 + offset] ?? "",
      withCoach: parseBoolean(parts[1 + offset] ?? "false"),
      coachName: parts[2 + offset] ?? null,
      notes: parts[3 + offset] ?? "",
    };
  }

  if (kind === "match") {
    const hasDate = isIsoDate(parts[0] ?? "");
    const offset = hasDate ? 1 : 0;
    return {
      date: hasDate ? (parts[0] ?? todayIsoDate()) : todayIsoDate(),
      opponent: parts[0 + offset] ?? "Unknown",
      score: parts[1 + offset] ?? "",
      notes: parts[2 + offset] ?? "",
    };
  }

  if (kind === "diet") {
    if (parts.length >= 2) {
      return { date: parts[0], summary: parts.slice(1).join("; ") };
    }
    return { date: todayIsoDate(), summary: parts[0] ?? "" };
  }

  const hasDate = isIsoDate(parts[0] ?? "");
  const offset = hasDate ? 1 : 0;
  const duration = Number(parts[0 + offset]);
  return {
    date: hasDate ? (parts[0] ?? todayIsoDate()) : todayIsoDate(),
    durationMin: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 30,
    exerciseType: parts[1 + offset] ?? "Other",
    notes: parts[2 + offset] ?? "",
  };
}

function defaultFields(kind: string, freeText: string): Record<string, unknown> {
  const date = todayIsoDate();
  const text = freeText.trim();

  if (kind === "goal") {
    return { weekStart: date, planText: text };
  }
  if (kind === "practice") {
    return { date, workedOn: text, withCoach: false, coachName: null, notes: "" };
  }
  if (kind === "match") {
    return { date, opponent: text || "Unknown", score: "", notes: "" };
  }
  if (kind === "diet") {
    return { date, summary: text };
  }
  return { date, durationMin: 30, exerciseType: "Other", notes: text };
}

export function parseFreeformJournalToStructuredItems(text: string): StructuredIngestInput[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items: StructuredIngestInput[] = [];

  for (const line of lines) {
    const normalizedLine = line.replace(/^\s*[-*•]\s*/, "");
    const match = normalizedLine.match(/^([a-zA-Z]+)\s*[:|]\s*(.+)$/);
    if (!match) {
      continue;
    }

    const kind = match[1]!.toLowerCase();
    const payload = match[2]!.trim();

    if (!JOURNAL_KIND_SET.has(kind)) {
      continue;
    }

    const hasNamedFields = /^[a-zA-Z][\w-]*\s*[:=]/.test(payload);
    const hasSemicolon = payload.includes(";");
    const fields = hasNamedFields
      ? parseKeyValueFields(payload)
      : hasSemicolon
        ? parsePositionalFields(kind, payload)
        : defaultFields(kind, payload);
    const warnings = hasNamedFields
      ? []
      : hasSemicolon
        ? ["Positional parsing used; please review before saving"]
        : ["Please review before saving"];

    items.push({
      confidence: hasNamedFields ? 0.85 : hasSemicolon ? 0.7 : 0.65,
      fields,
      kind,
      source: "journal-fallback",
      warnings,
    });
  }

  return items;
}
