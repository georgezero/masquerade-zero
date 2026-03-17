import assert from "node:assert/strict";
import test from "node:test";

import { applyJournalDateDefaults, parseJournalLlmJson } from "../llm.js";

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

test("throws for non-array response payload shape", () => {
  assert.throws(
    () =>
      parseJournalLlmJson(
        JSON.stringify({
          items: [
            {
              kind: "diet",
              fields: { date: "2026-03-16", summary: "High protein and hydration" },
            },
          ],
        }),
      ),
    /Expected array/,
  );
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

test("fills missing date fields with today's date and warning", () => {
  const today = "2026-03-17";
  const updated = applyJournalDateDefaults(
    [
      {
        kind: "practice",
        fields: { workedOn: "Serve", withCoach: false, coachName: null, notes: "" },
        confidence: 0.8,
        warnings: [],
      },
      {
        kind: "goal",
        fields: { planText: "Play with margin" },
        confidence: 0.7,
        warnings: [],
      },
    ],
    today,
  );

  const practice = updated[0] as { fields: Record<string, unknown>; warnings: unknown };
  const goal = updated[1] as { fields: Record<string, unknown>; warnings: unknown };

  assert.equal(practice.fields.date, today);
  assert.equal(goal.fields.weekStart, today);
  assert.match((practice.warnings as string[])[0] ?? "", /date missing; assumed today's date/);
  assert.match((goal.warnings as string[])[0] ?? "", /weekStart missing; assumed today's date/);
});

test("sanitizes unsupported fields and applies safe defaults", () => {
  const items = parseJournalLlmJson(
    JSON.stringify([
      {
        kind: "practice",
        fields: {
          date: "",
          workedOn: "",
          notes: "Long drilling block",
          withCoach: "yes",
          coachName: "",
          focusAreas: ["serve"],
        },
        confidence: 0.8,
        warnings: [],
      },
      {
        kind: "exercise",
        fields: {
          date: "",
          durationMin: "",
          exerciseType: "Sprint",
          notes: "Intervals",
          foo: "bar",
        },
        confidence: 0.7,
        warnings: [],
      },
    ]),
  );

  const practice = items[0] as { fields: Record<string, unknown>; warnings: string[] };
  const exercise = items[1] as { fields: Record<string, unknown>; warnings: string[] };

  assert.equal(practice.fields.workedOn, "Long drilling block");
  assert.equal(practice.fields.withCoach, true);
  assert.equal(practice.fields.coachName, null);
  assert.ok(practice.warnings.some((warning) => warning.includes("Dropped unsupported fields")));

  assert.equal(exercise.fields.durationMin, 30);
  assert.equal(exercise.fields.exerciseType, "Other");
  assert.ok(exercise.warnings.some((warning) => warning.includes("defaulted to Other")));
});
