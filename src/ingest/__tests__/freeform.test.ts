import assert from "node:assert/strict";
import test from "node:test";

import { parseFreeformJournalToStructuredItems } from "../freeform.js";

test("parses free-text lines with default mappings", () => {
  const parsed = parseFreeformJournalToStructuredItems(
    [
      "goal: Keep first serve above 60%",
      "diet: Hydration and protein focus",
      "exercise: Mobility block after practice",
    ].join("\n"),
  );

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]?.kind, "goal");
  assert.equal(parsed[1]?.kind, "diet");
  assert.equal(parsed[2]?.kind, "exercise");

  assert.equal((parsed[0]?.fields as Record<string, unknown>).planText, "Keep first serve above 60%");
  assert.equal((parsed[1]?.fields as Record<string, unknown>).summary, "Hydration and protein focus");
  assert.equal((parsed[2]?.fields as Record<string, unknown>).durationMin, 30);
});

test("parses key-value lines", () => {
  const parsed = parseFreeformJournalToStructuredItems(
    [
      "practice: date=2026-03-16; workedOn=Serve + return; withCoach=true; coachName=Coach Kim; notes=Short block",
      "match: date=2026-03-15; opponent=Alex; score=6-4 4-6 10-8; notes=Tiebreak finish",
    ].join("\n"),
  );

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.kind, "practice");
  assert.equal(parsed[1]?.kind, "match");

  assert.equal((parsed[0]?.fields as Record<string, unknown>).date, "2026-03-16");
  assert.equal((parsed[1]?.fields as Record<string, unknown>).opponent, "Alex");
});

test("parses positional fields when names are omitted", () => {
  const parsed = parseFreeformJournalToStructuredItems(
    [
      "practice: 2026-03-16; Serve + return; true; Coach Kim; Short block",
      "match: 2026-03-15; Alex; 6-4 4-6 10-8; Tiebreak finish",
      "exercise: 2026-03-14; 35; Mobility; Hip + shoulder sequence",
    ].join("\n"),
  );

  assert.equal(parsed.length, 3);

  const practiceFields = parsed[0]?.fields as Record<string, unknown>;
  const matchFields = parsed[1]?.fields as Record<string, unknown>;
  const exerciseFields = parsed[2]?.fields as Record<string, unknown>;

  assert.equal(practiceFields.date, "2026-03-16");
  assert.equal(practiceFields.workedOn, "Serve + return");
  assert.equal(practiceFields.withCoach, true);

  assert.equal(matchFields.opponent, "Alex");
  assert.equal(matchFields.score, "6-4 4-6 10-8");

  assert.equal(exerciseFields.durationMin, 35);
  assert.equal(exerciseFields.exerciseType, "Mobility");
});

test("parses bullet-style lines with leading dash/star/bullet", () => {
  const parsed = parseFreeformJournalToStructuredItems(
    [
      "- goal: Play more tennis this week",
      "  * diet: More hydration and protein",
      "• exercise: 2026-03-14; 35; Mobility; Hip + shoulder sequence",
    ].join("\n"),
  );

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]?.kind, "goal");
  assert.equal(parsed[1]?.kind, "diet");
  assert.equal(parsed[2]?.kind, "exercise");

  const goalFields = parsed[0]?.fields as Record<string, unknown>;
  const dietFields = parsed[1]?.fields as Record<string, unknown>;
  const exerciseFields = parsed[2]?.fields as Record<string, unknown>;

  assert.equal(goalFields.planText, "Play more tennis this week");
  assert.equal(dietFields.summary, "More hydration and protein");
  assert.equal(exerciseFields.durationMin, 35);
});

test("positional practice/match/exercise default date to today when omitted", () => {
  const today = new Date().toISOString().slice(0, 10);
  const parsed = parseFreeformJournalToStructuredItems(
    [
      "practice: Serve + return; true; Coach Kim; Short block",
      "match: Alex; 6-4 4-6 10-8; Tiebreak finish",
      "exercise: 35; Mobility; Hip + shoulder sequence",
    ].join("\n"),
  );

  assert.equal(parsed.length, 3);

  const practiceFields = parsed[0]?.fields as Record<string, unknown>;
  const matchFields = parsed[1]?.fields as Record<string, unknown>;
  const exerciseFields = parsed[2]?.fields as Record<string, unknown>;

  assert.equal(practiceFields.date, today);
  assert.equal(practiceFields.workedOn, "Serve + return");

  assert.equal(matchFields.date, today);
  assert.equal(matchFields.opponent, "Alex");

  assert.equal(exerciseFields.date, today);
  assert.equal(exerciseFields.durationMin, 35);
});
