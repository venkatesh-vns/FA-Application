-- Indexes for a year+ of data (100,000+ records, 300,000+ product lines)

-- "contains" search on Inv No (original invoice lookup, FA Data search):
-- trigram index when the pg_trgm extension can be created by this login
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'pg_trgm not available (needs a database owner); Inv No search works without the trigram index';
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS fa_records_inv_no_trgm ON fa_records USING gin (LOWER(inv_no) gin_trgm_ops)';
  END IF;
END $$;

-- what was already reversed against an FA Code (credit-note lines)
CREATE INDEX qty_lines_against_asset_idx ON qty_lines (LOWER(TRIM(against_asset_code))) WHERE product_amount < 0;
-- Cost Center filters (any case)
CREATE INDEX fa_records_cost_center_idx ON fa_records (LOWER(TRIM(cost_center)));
-- Pending lists
CREATE INDEX fa_records_pending_idx ON fa_records (fa_id) WHERE status <> 'Completed';
