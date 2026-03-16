CREATE TABLE IF NOT EXISTS ingest_idempotency (
  idempotency_key text PRIMARY KEY,
  request_hash text NOT NULL,
  status text NOT NULL,
  status_code integer,
  response_body text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingest_idempotency_expires_at_idx
  ON ingest_idempotency (expires_at);

CREATE TABLE IF NOT EXISTS ingest_rate_limits (
  bucket_key text PRIMARY KEY,
  window_start_ms text NOT NULL,
  count integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingest_rate_limits_updated_at_idx
  ON ingest_rate_limits (updated_at);
