import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { serve, type ServerType } from "@hono/node-server";

async function main() {
  process.env.INGEST_API_KEYS_JSON = JSON.stringify([
    {
      id: "dryrun-only",
      key: "tz6_scope_dryrun_key",
      scopes: ["ingest:dryrun"],
      allowedUserIds: ["allowed-user"],
    },
    {
      id: "writer",
      key: "tz6_scope_writer_key",
      scopes: ["ingest:write", "ingest:dryrun"],
    },
  ]);
  delete process.env.INGEST_API_KEY;
  process.env.PORT = "3214";
  process.env.APP_URL = "http://127.0.0.1:3214";

  const { default: app } = await import("../src/index.ts");

  const baseUrl = "http://127.0.0.1:3214";
  let server: ServerType | null = null;

  try {
    server = serve({ fetch: app.fetch, port: 3214 });
    await delay(100);

    // dryrun key can dryrun for allowed user
    {
      const response = await fetch(`${baseUrl}/api/ingest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer tz6_scope_dryrun_key",
        },
        body: JSON.stringify({
          mode: "structured",
          userId: "allowed-user",
          dryRun: true,
          items: [{ kind: "goal", fields: { weekStart: "2026-03-16", planText: "ok" } }],
        }),
      });
      assert.equal(response.status, 200);
    }

    // dryrun key cannot write
    {
      const response = await fetch(`${baseUrl}/api/ingest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer tz6_scope_dryrun_key",
        },
        body: JSON.stringify({
          mode: "structured",
          userId: "allowed-user",
          items: [{ kind: "goal", fields: { weekStart: "2026-03-16", planText: "no write" } }],
        }),
      });
      assert.equal(response.status, 403);
    }

    // dryrun key cannot access disallowed user
    {
      const response = await fetch(`${baseUrl}/api/ingest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer tz6_scope_dryrun_key",
        },
        body: JSON.stringify({
          mode: "structured",
          userId: "blocked-user",
          dryRun: true,
          items: [{ kind: "goal", fields: { weekStart: "2026-03-16", planText: "blocked" } }],
        }),
      });
      assert.equal(response.status, 403);
    }

    // writer key can write (dryRun false)
    {
      const response = await fetch(`${baseUrl}/api/ingest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer tz6_scope_writer_key",
        },
        body: JSON.stringify({
          mode: "structured",
          userId: "allowed-user",
          dryRun: true,
          items: [{ kind: "diet", fields: { date: "2026-03-16", summary: "scope test" } }],
        }),
      });
      assert.equal(response.status, 200);
    }

    console.log("Ingest API scope checks passed (200/403 coverage).");
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
  console.error("Ingest API scope integration test failed.");
  console.error(error);
  process.exitCode = 1;
});
