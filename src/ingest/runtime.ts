import { and, eq, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { ingestIdempotency, ingestRateLimits } from "../db/schema.js";

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number };

type RateLimitBucket = {
  count: number;
  resetAtMs: number;
};

export type IdempotencyStartResult =
  | { state: "new" }
  | { state: "in_flight" }
  | { state: "replay"; responseBody: unknown; statusCode: number }
  | { state: "conflict" };

export type IngestRuntime = {
  beginIdempotentRequest(key: string, fingerprint: string, nowMs?: number): Promise<IdempotencyStartResult>;
  checkRateLimit(key: string, nowMs?: number): Promise<RateLimitResult>;
  cleanupExpiredData(nowMs?: number): Promise<void>;
  completeIdempotentRequest(
    key: string,
    fingerprint: string,
    responseBody: unknown,
    statusCode: number,
    nowMs?: number,
  ): Promise<void>;
};

type IdempotencyRecord = {
  expiresAtMs: number;
  fingerprint: string;
  responseBody?: unknown;
  startedAtMs: number;
  status: "in_flight" | "completed";
  statusCode?: number;
};

export class InMemoryIngestRuntime implements IngestRuntime {
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly rateLimit = new Map<string, RateLimitBucket>();

  constructor(
    private readonly rateLimitWindowMs: number,
    private readonly rateLimitMax: number,
    private readonly idempotencyTtlMs: number,
  ) {}

  async checkRateLimit(key: string, nowMs = Date.now()): Promise<RateLimitResult> {
    const current = this.rateLimit.get(key);
    if (!current || current.resetAtMs <= nowMs) {
      this.rateLimit.set(key, {
        count: 1,
        resetAtMs: nowMs + this.rateLimitWindowMs,
      });
      return { allowed: true };
    }

    if (current.count >= this.rateLimitMax) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((current.resetAtMs - nowMs) / 1000)),
      };
    }

    current.count += 1;
    return { allowed: true };
  }

  async beginIdempotentRequest(key: string, fingerprint: string, nowMs = Date.now()): Promise<IdempotencyStartResult> {
    const existing = this.idempotency.get(key);
    if (!existing || existing.expiresAtMs <= nowMs) {
      this.idempotency.set(key, {
        expiresAtMs: nowMs + this.idempotencyTtlMs,
        fingerprint,
        startedAtMs: nowMs,
        status: "in_flight",
      });
      return { state: "new" };
    }

    if (existing.fingerprint !== fingerprint) {
      return { state: "conflict" };
    }

    if (existing.status === "in_flight") {
      return { state: "in_flight" };
    }

    return {
      state: "replay",
      responseBody: existing.responseBody,
      statusCode: existing.statusCode ?? 200,
    };
  }

  async completeIdempotentRequest(
    key: string,
    fingerprint: string,
    responseBody: unknown,
    statusCode: number,
    nowMs = Date.now(),
  ): Promise<void> {
    const existing = this.idempotency.get(key);
    if (!existing || existing.expiresAtMs <= nowMs) {
      return;
    }
    if (existing.fingerprint !== fingerprint || existing.status !== "in_flight") {
      return;
    }

    this.idempotency.set(key, {
      ...existing,
      responseBody,
      status: "completed",
      statusCode,
    });
  }

  async cleanupExpiredData(nowMs = Date.now()): Promise<void> {
    for (const [key, value] of this.idempotency.entries()) {
      if (value.expiresAtMs <= nowMs) {
        this.idempotency.delete(key);
      }
    }
    for (const [key, value] of this.rateLimit.entries()) {
      if (value.resetAtMs <= nowMs) {
        this.rateLimit.delete(key);
      }
    }
  }
}

type PostgresIdempotencyRow = {
  requestHash: string;
  responseBody: string | null;
  status: "in_flight" | "completed";
  statusCode: number | null;
  expiresAtMs: string | number;
};

type PostgresRateRow = {
  count: number;
  windowStartMs: string;
};

export class PostgresIngestRuntime implements IngestRuntime {
  private readonly fallback: InMemoryIngestRuntime;

  constructor(
    private readonly rateLimitWindowMs: number,
    private readonly rateLimitMax: number,
    private readonly idempotencyTtlMs: number,
  ) {
    this.fallback = new InMemoryIngestRuntime(rateLimitWindowMs, rateLimitMax, idempotencyTtlMs);
  }

  private hasDb() {
    return Boolean(db);
  }

  async checkRateLimit(key: string, nowMs = Date.now()): Promise<RateLimitResult> {
    if (!this.hasDb()) {
      return this.fallback.checkRateLimit(key, nowMs);
    }

    const windowStartMs = Math.floor(nowMs / this.rateLimitWindowMs) * this.rateLimitWindowMs;
    const result = await db!.execute<PostgresRateRow>(sql`
      INSERT INTO ingest_rate_limits (bucket_key, window_start_ms, count, updated_at)
      VALUES (${key}, ${String(windowStartMs)}, 1, now())
      ON CONFLICT (bucket_key) DO UPDATE SET
        count = CASE
          WHEN ingest_rate_limits.window_start_ms = EXCLUDED.window_start_ms THEN ingest_rate_limits.count + 1
          ELSE 1
        END,
        window_start_ms = EXCLUDED.window_start_ms,
        updated_at = now()
      RETURNING count, window_start_ms AS "windowStartMs"
    `);

    const row = result.rows[0];
    if (!row || row.count <= this.rateLimitMax) {
      return { allowed: true };
    }

    const resetAtMs = Number(row.windowStartMs) + this.rateLimitWindowMs;
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000)),
    };
  }

  async beginIdempotentRequest(key: string, fingerprint: string, nowMs = Date.now()): Promise<IdempotencyStartResult> {
    if (!this.hasDb()) {
      return this.fallback.beginIdempotentRequest(key, fingerprint, nowMs);
    }

    const expiresAt = new Date(nowMs + this.idempotencyTtlMs);
    const inserted = await db!.execute(sql`
      INSERT INTO ingest_idempotency
        (idempotency_key, request_hash, status, status_code, response_body, expires_at, created_at, updated_at)
      VALUES
        (${key}, ${fingerprint}, 'in_flight', NULL, NULL, ${expiresAt}, now(), now())
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING idempotency_key
    `);

    if (inserted.rows.length > 0) {
      return { state: "new" };
    }

    const current = await this.loadCurrentIdempotencyRow(key);
    if (!current) {
      return { state: "new" };
    }

    if (Number(current.expiresAtMs) <= nowMs) {
      const recycled = await db!.execute(sql`
        UPDATE ingest_idempotency
        SET
          request_hash = ${fingerprint},
          status = 'in_flight',
          status_code = NULL,
          response_body = NULL,
          expires_at = ${expiresAt},
          updated_at = now()
        WHERE idempotency_key = ${key}
          AND EXTRACT(EPOCH FROM expires_at) * 1000 <= ${nowMs}
        RETURNING idempotency_key
      `);
      if (recycled.rows.length > 0) {
        return { state: "new" };
      }
    }

    const row = await this.loadCurrentIdempotencyRow(key);
    if (!row) {
      return { state: "new" };
    }
    if (row.requestHash !== fingerprint) {
      return { state: "conflict" };
    }
    if (row.status === "in_flight") {
      return { state: "in_flight" };
    }

    return {
      state: "replay",
      responseBody: row.responseBody ? JSON.parse(row.responseBody) : null,
      statusCode: row.statusCode ?? 200,
    };
  }

  async completeIdempotentRequest(
    key: string,
    fingerprint: string,
    responseBody: unknown,
    statusCode: number,
    nowMs = Date.now(),
  ): Promise<void> {
    if (!this.hasDb()) {
      return this.fallback.completeIdempotentRequest(key, fingerprint, responseBody, statusCode, nowMs);
    }

    await db!
      .update(ingestIdempotency)
      .set({
        status: "completed",
        statusCode,
        responseBody: JSON.stringify(responseBody),
        updatedAt: new Date(nowMs),
      })
      .where(
        and(
          eq(ingestIdempotency.idempotencyKey, key),
          eq(ingestIdempotency.requestHash, fingerprint),
          eq(ingestIdempotency.status, "in_flight"),
        ),
      );
  }

  async cleanupExpiredData(nowMs = Date.now()): Promise<void> {
    if (!this.hasDb()) {
      await this.fallback.cleanupExpiredData(nowMs);
      return;
    }

    const now = new Date(nowMs);
    const rateLimitCutoff = new Date(nowMs - this.rateLimitWindowMs * 2);

    await db!.delete(ingestIdempotency).where(sql`${ingestIdempotency.expiresAt} <= ${now}`);
    await db!.delete(ingestRateLimits).where(sql`${ingestRateLimits.updatedAt} <= ${rateLimitCutoff}`);
  }

  private async loadCurrentIdempotencyRow(key: string): Promise<PostgresIdempotencyRow | null> {
    const result = await db!.execute<PostgresIdempotencyRow>(sql`
      SELECT
        request_hash AS "requestHash",
        response_body AS "responseBody",
        status,
        status_code AS "statusCode",
        EXTRACT(EPOCH FROM expires_at) * 1000 AS "expiresAtMs"
      FROM ingest_idempotency
      WHERE idempotency_key = ${key}
      LIMIT 1
    `);
    return result.rows[0] ?? null;
  }
}
