import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { serve, type ServerType } from "@hono/node-server";

async function main() {
  process.env.DATABASE_URL ??= "";
  process.env.INGEST_API_KEY = "tz6_ingest_db_test_0a1b2c3d4e5f6g7h8i9j";
  process.env.INGEST_RATE_LIMIT_WINDOW_MS = "60000";
  process.env.INGEST_RATE_LIMIT_MAX = "100";
  process.env.INGEST_IDEMPOTENCY_TTL_MS = "200";
  process.env.PORT = "3212";
  process.env.APP_URL = "http://127.0.0.1:3212";

  const { default: app } = await import("../src/index.ts");

  const port = 3212;
  const baseUrl = `http://127.0.0.1:${port}`;
  let server: ServerType | null = null;

  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.INGEST_API_KEY}`,
  };

  const replayKey = `db-replay-${Date.now()}`;
  const replayPayload = {
    mode: "structured",
    userId: "db-replay-user",
    dryRun: true,
    idempotencyKey: replayKey,
    items: [
      {
        kind: "goal",
        fields: {
          weekStart: "2026-03-16",
          planText: "DB replay payload",
        },
      },
    ],
  } as const;

  const expiryKey = `db-expire-${Date.now()}`;

  try {
    server = serve({ fetch: app.fetch, port });
    await delay(100);

    // Replay behavior: identical payload + key should return cached identical JSON response.
    const firstReplayResponse = await fetch(`${baseUrl}/api/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify(replayPayload),
    });
    assert.equal(firstReplayResponse.status, 200);
    const firstReplayJson = (await firstReplayResponse.json()) as Record<string, unknown>;

    const secondReplayResponse = await fetch(`${baseUrl}/api/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify(replayPayload),
    });
    assert.equal(secondReplayResponse.status, 200);
    const secondReplayJson = (await secondReplayResponse.json()) as Record<string, unknown>;

    assert.deepEqual(secondReplayJson, firstReplayJson);

    // Expiry behavior: same key can be reused with different payload after TTL expires.
    const firstExpiryResponse = await fetch(`${baseUrl}/api/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: "structured",
        userId: "db-expire-user",
        dryRun: true,
        idempotencyKey: expiryKey,
        items: [
          {
            kind: "goal",
            fields: {
              weekStart: "2026-03-16",
              planText: "Before expiry",
            },
          },
        ],
      }),
    });
    assert.equal(firstExpiryResponse.status, 200);

    await delay(350);

    const afterExpiryResponse = await fetch(`${baseUrl}/api/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: "structured",
        userId: "db-expire-user",
        dryRun: true,
        idempotencyKey: expiryKey,
        items: [
          {
            kind: "goal",
            fields: {
              weekStart: "2026-03-16",
              planText: "After expiry with changed payload",
            },
          },
        ],
      }),
    });

    assert.equal(afterExpiryResponse.status, 200);
    const afterExpiryJson = (await afterExpiryResponse.json()) as {
      accepted?: boolean;
      errors?: unknown[];
    };
    assert.equal(afterExpiryJson.accepted, true);
    assert.deepEqual(afterExpiryJson.errors, []);

    console.log("DB-backed ingest idempotency checks passed (replay + expiry).\n");
  } finally {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

main().catch((error) => {
  console.error("DB-backed ingest integration test failed.");
  console.error(error);
  process.exitCode = 1;
});
