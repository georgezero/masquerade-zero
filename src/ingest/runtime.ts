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

type IdempotencyRecord = {
  expiresAtMs: number;
  fingerprint: string;
  responseBody?: unknown;
  startedAtMs: number;
  status: "in_flight" | "completed";
  statusCode?: number;
};

export class InMemoryIngestRuntime {
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly rateLimit = new Map<string, RateLimitBucket>();

  constructor(
    private readonly rateLimitWindowMs: number,
    private readonly rateLimitMax: number,
    private readonly idempotencyTtlMs: number,
  ) {}

  checkRateLimit(key: string, nowMs = Date.now()): RateLimitResult {
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

  beginIdempotentRequest(key: string, fingerprint: string, nowMs = Date.now()): IdempotencyStartResult {
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

  completeIdempotentRequest(key: string, fingerprint: string, responseBody: unknown, statusCode: number, nowMs = Date.now()) {
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
}
