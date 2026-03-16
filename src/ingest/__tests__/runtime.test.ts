import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryIngestRuntime } from "../runtime.js";

test("rate limit blocks after max requests in window", async () => {
  const runtime = new InMemoryIngestRuntime(1_000, 2, 60_000);

  const first = await runtime.checkRateLimit("k", 0);
  const second = await runtime.checkRateLimit("k", 100);
  const third = await runtime.checkRateLimit("k", 200);

  assert.deepEqual(first, { allowed: true });
  assert.deepEqual(second, { allowed: true });
  assert.equal(third.allowed, false);
  if (!third.allowed) {
    assert.equal(third.retryAfterSec, 1);
  }

  const afterWindow = await runtime.checkRateLimit("k", 1_100);
  assert.deepEqual(afterWindow, { allowed: true });
});

test("idempotency supports replay and conflict", async () => {
  const runtime = new InMemoryIngestRuntime(1_000, 10, 60_000);

  const start = await runtime.beginIdempotentRequest("id-key", "fingerprint-a", 0);
  assert.deepEqual(start, { state: "new" });

  const inflight = await runtime.beginIdempotentRequest("id-key", "fingerprint-a", 100);
  assert.deepEqual(inflight, { state: "in_flight" });

  await runtime.completeIdempotentRequest("id-key", "fingerprint-a", { ok: true }, 201, 150);

  const replay = await runtime.beginIdempotentRequest("id-key", "fingerprint-a", 200);
  assert.equal(replay.state, "replay");
  if (replay.state === "replay") {
    assert.equal(replay.statusCode, 201);
    assert.deepEqual(replay.responseBody, { ok: true });
  }

  const conflict = await runtime.beginIdempotentRequest("id-key", "fingerprint-b", 250);
  assert.deepEqual(conflict, { state: "conflict" });
});
