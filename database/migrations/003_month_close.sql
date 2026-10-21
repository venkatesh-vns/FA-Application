-- Month-wise close: every record belongs to the month it is booked in Tally
-- ('YYYY-MM'); each month moves Open -> Under Review -> Finalized -> FAMS Uploaded
-- and can be re-opened by an Admin with a reason.
-- allow-data-change: fills the new book_month column of existing rows (no values are lost)

-- Tally booking month of each record (existing records: their invoice month)
ALTER TABLE fa_records ADD COLUMN book_month VARCHAR(7);
UPDATE fa_records SET book_month = to_char(inv_date, 'YYYY-MM');
ALTER TABLE fa_records ALTER COLUMN book_month SET NOT NULL;
ALTER TABLE fa_records ADD CONSTRAINT fa_records_book_month_chk CHECK (book_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
CREATE INDEX fa_records_book_month_idx ON fa_records (book_month);

-- Tally (LWM) figures are uploaded per month; the existing single upload
-- belongs to the newest month that has records
ALTER TABLE lwm_tally ADD COLUMN book_month VARCHAR(7);
UPDATE lwm_tally SET book_month = COALESCE((SELECT MAX(book_month) FROM fa_records), to_char(CURRENT_DATE, 'YYYY-MM'));
ALTER TABLE lwm_tally ALTER COLUMN book_month SET NOT NULL;
CREATE INDEX lwm_tally_book_month_idx ON lwm_tally (book_month);

CREATE TABLE month_periods (
  book_month        VARCHAR(7) PRIMARY KEY,
  status            VARCHAR(20) NOT NULL DEFAULT 'Open'
                    CHECK (status IN ('Open', 'Under Review', 'Finalized', 'FAMS Uploaded')),
  version           INTEGER NOT NULL DEFAULT 0,      -- times finalized
  submitted_by      VARCHAR(150),
  submitted_at      TIMESTAMP,
  finalized_by      VARCHAR(150),
  finalized_at      TIMESTAMP,
  lwm_remark        TEXT NOT NULL DEFAULT '',        -- Admin note accepting a Tally difference
  fams_reference    VARCHAR(200) NOT NULL DEFAULT '',
  fams_uploaded_on  DATE,
  fams_uploaded_by  VARCHAR(150),
  reopened_by       VARCHAR(150),
  reopened_at       TIMESTAMP,
  reopen_reason     TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Months before the current month are closed: Finalized as they stand
INSERT INTO month_periods (book_month, status, version, finalized_by, finalized_at, lwm_remark)
SELECT DISTINCT book_month, 'Finalized', 1, 'System', NOW(), 'Finalized when month-wise close was introduced.'
FROM fa_records WHERE book_month < to_char(CURRENT_DATE, 'YYYY-MM');
INSERT INTO month_periods (book_month) SELECT DISTINCT book_month FROM fa_records ON CONFLICT DO NOTHING;

-- Every record's month has a month_periods row (also for imports)
CREATE FUNCTION fa_records_book_month() RETURNS trigger AS $$
BEGIN
  IF NEW.book_month IS NULL OR NEW.book_month = '' THEN
    NEW.book_month := to_char(NEW.inv_date, 'YYYY-MM');
  END IF;
  INSERT INTO month_periods (book_month) VALUES (NEW.book_month) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER fa_records_book_month_trg BEFORE INSERT OR UPDATE OF book_month ON fa_records
  FOR EACH ROW EXECUTE FUNCTION fa_records_book_month();

CREATE FUNCTION lwm_tally_book_month() RETURNS trigger AS $$
BEGIN
  IF NEW.book_month IS NULL OR NEW.book_month = '' THEN
    NEW.book_month := to_char(CURRENT_DATE, 'YYYY-MM');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER lwm_tally_book_month_trg BEFORE INSERT ON lwm_tally
  FOR EACH ROW EXECUTE FUNCTION lwm_tally_book_month();

-- What happened to each month (submitted, sent back, finalized, re-opened ...)
CREATE TABLE month_events (
  event_id     SERIAL PRIMARY KEY,
  book_month   VARCHAR(7) NOT NULL REFERENCES month_periods (book_month),
  action       VARCHAR(40) NOT NULL,
  status_from  VARCHAR(20) NOT NULL DEFAULT '',
  status_to    VARCHAR(20) NOT NULL DEFAULT '',
  username     VARCHAR(100) NOT NULL DEFAULT '',
  name         VARCHAR(150) NOT NULL DEFAULT '',
  details      TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX month_events_month_idx ON month_events (book_month, event_id);

-- The FAMS rows of a month as finalized (one per version), with a fingerprint,
-- and the changes-only rows against the previous version. kind 'baseline' =
-- copy taken at re-opening of a month finalized before snapshots existed.
CREATE TABLE month_snapshots (
  snapshot_id   SERIAL PRIMARY KEY,
  book_month    VARCHAR(7) NOT NULL REFERENCES month_periods (book_month),
  version       INTEGER NOT NULL,
  kind          VARCHAR(10) NOT NULL DEFAULT 'finalized' CHECK (kind IN ('finalized', 'baseline')),
  record_count  INTEGER NOT NULL,
  line_count    INTEGER NOT NULL,
  total_amount  NUMERIC(15, 2) NOT NULL,
  fingerprint   CHAR(64) NOT NULL,
  fams_rows     JSONB NOT NULL,                     -- [{ lineId, faCode, values: [...] }]
  changes       JSONB,                              -- [{ type, fields, values }] vs previous version
  change_count  INTEGER NOT NULL DEFAULT 0,
  created_by    VARCHAR(150) NOT NULL DEFAULT '',
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (book_month, version)
);

-- Field-level history: what changed, old -> new, who, when, from which screen
CREATE TABLE change_history (
  change_id    SERIAL PRIMARY KEY,
  fa_code      VARCHAR(20) NOT NULL,
  book_month   VARCHAR(7) NOT NULL DEFAULT '',
  line_id      INTEGER,
  field        VARCHAR(100) NOT NULL,
  old_value    TEXT NOT NULL DEFAULT '',
  new_value    TEXT NOT NULL DEFAULT '',
  source       VARCHAR(40) NOT NULL DEFAULT '',
  username     VARCHAR(100) NOT NULL DEFAULT '',
  name         VARCHAR(150) NOT NULL DEFAULT '',
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX change_history_fa_idx ON change_history (fa_code, change_id);
CREATE INDEX change_history_month_idx ON change_history (book_month, change_id);
