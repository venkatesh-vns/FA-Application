-- Year-End Archive: a period's transaction data is copied to the archive
-- database (ARCHIVE_DB_NAME, default <DB_NAME>_archive), checked, then deleted
-- from the live database. Each run is recorded here so the live system knows
-- which months are archived (they cannot be booked into) and can restore them.
CREATE TABLE archive_runs (
  run_id        SERIAL PRIMARY KEY,
  from_month    VARCHAR(7) NOT NULL,
  to_month      VARCHAR(7) NOT NULL,
  label         VARCHAR(60) NOT NULL,
  status        VARCHAR(12) NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'archived', 'failed', 'restored')),
  record_count  INTEGER NOT NULL DEFAULT 0,
  line_count    INTEGER NOT NULL DEFAULT 0,
  total_amount  NUMERIC(15, 2) NOT NULL DEFAULT 0,
  table_counts  JSONB NOT NULL DEFAULT '{}',     -- rows per table moved
  summary       JSONB NOT NULL DEFAULT '[]',     -- per month: records, lines, amount, status
  backup_file   VARCHAR(500) NOT NULL DEFAULT '',
  backup_bytes  BIGINT NOT NULL DEFAULT 0,
  error         TEXT NOT NULL DEFAULT '',
  created_by    VARCHAR(150) NOT NULL DEFAULT '',
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMP,
  restored_by   VARCHAR(150),
  restored_at   TIMESTAMP,
  restore_backup_file VARCHAR(500) NOT NULL DEFAULT ''
);
CREATE INDEX archive_runs_months_idx ON archive_runs (from_month, to_month) WHERE status = 'archived';
