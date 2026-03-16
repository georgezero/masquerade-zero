import assert from "node:assert/strict";
import test from "node:test";

import { IngestService } from "../service.js";
import type { IngestPersisters, IngestRequest, PersistEntry } from "../types.js";

function createPersistersTracker() {
  const calls: Array<{ body: Record<string, unknown>; kind: string; userId: string }> = [];
  const persist = (kind: string): PersistEntry => async (userId, body) => {
    calls.push({ body, kind, userId });
  };

  const persisters: IngestPersisters = {
    diet: persist("diet"),
    exercise: persist("exercise"),
    goal: persist("goal"),
    match: persist("match"),
    practice: persist("practice"),
  };

  return { calls, persisters };
}

test("dryRun validates all entry kinds and does not persist", async () => {
  const { calls, persisters } = createPersistersTracker();
  const service = new IngestService(persisters);

  const request: IngestRequest = {
    dryRun: true,
    items: [
      { fields: { planText: " Win local ladder ", weekStart: "2026-03-16" }, kind: "goal" },
      { fields: { coachName: " Coach K ", date: "2026-03-15", notes: " Solid session ", withCoach: true, workedOn: "Serve" }, kind: "practice" },
      { fields: { date: "2026-03-14", notes: "Tie-break was close", opponent: "Alex", score: "6-4 4-6 10-8" }, kind: "match" },
      { fields: { date: "2026-03-14", summary: "High protein day" }, kind: "diet" },
      { fields: { date: "2026-03-13", durationMin: 45, exerciseType: "Cardio", notes: "Bike" }, kind: "exercise" },
    ],
    mode: "structured",
  };

  const result = await service.ingest("user-1", request);

  assert.equal(result.accepted, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.candidates.length, 5);
  assert.equal(result.created.length, 0);
  assert.equal(calls.length, 0);

  const goal = result.candidates.find((item) => item.kind === "goal");
  const practice = result.candidates.find((item) => item.kind === "practice");
  const match = result.candidates.find((item) => item.kind === "match");
  const diet = result.candidates.find((item) => item.kind === "diet");
  const exercise = result.candidates.find((item) => item.kind === "exercise");

  assert.ok(goal);
  assert.ok(practice);
  assert.ok(match);
  assert.ok(diet);
  assert.ok(exercise);

  assert.equal(goal.fields.planText, "Win local ladder");
  assert.equal(practice.fields.coachName, "Coach K");
  assert.equal(match.fields.opponent, "Alex");
  assert.equal(diet.fields.summary, "High protein day");
  assert.equal(exercise.fields.exerciseType, "Cardio");
});

test("non-dry run persists normalized payloads", async () => {
  const { calls, persisters } = createPersistersTracker();
  const service = new IngestService(persisters);

  const request: IngestRequest = {
    items: [
      { fields: { planText: " Keep depth ", weekStart: "2026-03-16" }, kind: "goal" },
      { fields: { date: "2026-03-13", durationMin: "30", notes: " Mobility focus " }, kind: "exercise" },
    ],
    mode: "structured",
  };

  const result = await service.ingest("user-2", request);

  assert.equal(result.accepted, true);
  assert.equal(result.created.length, 2);
  assert.equal(calls.length, 2);

  assert.deepEqual(calls[0], {
    body: { planText: "Keep depth", weekStart: "2026-03-16" },
    kind: "goal",
    userId: "user-2",
  });

  assert.deepEqual(calls[1], {
    body: { date: "2026-03-13", durationMin: 30, exerciseType: "Other", notes: "Mobility focus" },
    kind: "exercise",
    userId: "user-2",
  });
});

test("validation errors are returned with item index", async () => {
  const { persisters } = createPersistersTracker();
  const service = new IngestService(persisters);

  const request: IngestRequest = {
    dryRun: true,
    items: [
      { fields: { weekStart: "2026-03-16" }, kind: "goal" },
      { fields: { date: "2026-03-14", summary: "okay" }, kind: "diet" },
    ],
    mode: "structured",
  };

  const result = await service.ingest("user-3", request);

  assert.equal(result.accepted, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]?.index, 0);
  assert.equal(result.candidates.length, 1);
});
