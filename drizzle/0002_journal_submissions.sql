CREATE TABLE IF NOT EXISTS journal_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  raw_text text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS journal_submissions_user_id_idx
  ON journal_submissions (user_id);

CREATE INDEX IF NOT EXISTS journal_submissions_status_idx
  ON journal_submissions (status);

CREATE TABLE IF NOT EXISTS journal_submission_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL,
  candidate_index integer NOT NULL,
  kind text NOT NULL,
  confidence integer NOT NULL,
  payload_json text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS journal_submission_candidates_journal_id_idx
  ON journal_submission_candidates (journal_id);

CREATE UNIQUE INDEX IF NOT EXISTS journal_submission_candidates_journal_index_unique
  ON journal_submission_candidates (journal_id, candidate_index);

CREATE TABLE IF NOT EXISTS journal_submission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL,
  candidate_index integer,
  kind text NOT NULL,
  entry_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS journal_submission_entries_journal_id_idx
  ON journal_submission_entries (journal_id);

CREATE INDEX IF NOT EXISTS journal_submission_entries_entry_id_idx
  ON journal_submission_entries (entry_id);
