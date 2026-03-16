import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { serve, type ServerType } from "@hono/node-server";

async function main() {
  process.env.INGEST_API_KEY = "tz6_ingest_test_4f6d9a2b8c1e3f7a5d0b4e2c9a1f6d3b";
  process.env.INGEST_RATE_LIMIT_WINDOW_MS = "60000";
  process.env.INGEST_RATE_LIMIT_MAX = "2";
  process.env.INGEST_IDEMPOTENCY_TTL_MS = "60000";

  const { default: app } = await import("../src/index.ts");

  const port = 3211;
  const baseUrl = `http://127.0.0.1:${port}`;
  let server: ServerType | null = null;

  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.INGEST_API_KEY}`,
  };

  const structuredBody = {
    mode: "structured",
    userId: "int-user-a",
    dryRun: true,
    idempotencyKey: "int-idem-001",
    items: [
      {
        kind: "goal",
        fields: {
          weekStart: "2026-03-16",
          planText: "Keep first serve above 60%",
        },
      },
    ],
  };

  try {
    server = serve({ fetch: app.fetch, port });
    await delay(80);

    // 401 when API key is missing
    {
      const response = await fetch(`${baseUrl}/api/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(structuredBody),
      });
      assert.equal(response.status, 401);
    }

    // 200 for authorized structured dry-run
    {
      const response = await fetch(`${baseUrl}/api/ingest`, {
        method: "POST",
        headers,
        body: JSON.stringify(structuredBody),
      });
      assert.equal(response.status, 200);
      const json = (await response.json()) as { accepted?: boolean; errors?: unknown[] };
      assert.equal(json.accepted, true);
      assert.deepEqual(json.errors, []);
    }

    // 409 for same idempotency key with different payload
    {
      const response = await fetch(`${baseUrl}/api/ingest`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...structuredBody,
          items: [
            {
              kind: "goal",
              fields: {
                weekStart: "2026-03-16",
                planText: "Different payload",
              },
            },
          ],
        }),
      });
      assert.equal(response.status, 409);
    }

    // 429 when rate limit is exceeded (2 requests per window)
    {
      const makeRateLimitedRequest = (suffix: number) =>
        fetch(`${baseUrl}/api/ingest`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            mode: "structured",
            userId: "int-user-rate",
            dryRun: true,
            items: [
              {
                kind: "diet",
                fields: {
                  date: "2026-03-16",
                  summary: `Meal summary ${suffix}`,
                },
              },
            ],
          }),
        });

      const r1 = await makeRateLimitedRequest(1);
      const r2 = await makeRateLimitedRequest(2);
      const r3 = await makeRateLimitedRequest(3);

      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);
      assert.equal(r3.status, 429);
      assert.ok(r3.headers.get("retry-after"));
    }

    console.log("Ingest API integration checks passed (401, 200, 409, 429).");
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
  console.error("Ingest API integration test failed.");
  console.error(error);
  process.exitCode = 1;
});
