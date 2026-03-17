import assert from "node:assert/strict";
import test from "node:test";

import { parseJournalLlmJson } from "../llm.js";

test("parses JSON array content into structured ingest items", () => {
  const items = parseJournalLlmJson(
    [
      "```json",
      JSON.stringify([
        {
          kind: "goal",
          fields: { weekStart: "2026-03-16", planText: "Hold 60% first serve" },
          confidence: 0.91,
          warnings: [],
        },
      ]),
      "```",
    ].join("\n"),
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, "goal");
  assert.equal(items[0]?.source, "journal-ai");
  assert.equal((items[0]?.fields as Record<string, unknown>).planText, "Hold 60% first serve");
});

test("parses { items: [...] } JSON object form", () => {
  const items = parseJournalLlmJson(
    JSON.stringify({
      items: [
        {
          kind: "diet",
          fields: { date: "2026-03-16", summary: "High protein and hydration" },
          confidence: 0.76,
          warnings: ["Date inferred from context"],
        },
      ],
    }),
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, "diet");
  assert.deepEqual(items[0]?.warnings, ["Date inferred from context"]);
});

test("throws for invalid JSON", () => {
  assert.throws(() => parseJournalLlmJson("{invalid-json"), /Could not parse LLM JSON response/);
});

test("throws for invalid schema payload", () => {
  assert.throws(
    () =>
      parseJournalLlmJson(
        JSON.stringify([
          {
            kind: "not-a-kind",
            fields: {},
          },
        ]),
      ),
    /Invalid enum value/,
  );
});
