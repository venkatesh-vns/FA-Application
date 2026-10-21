-- FA Data search ("search any column") with an index: the searchable text of
-- each record is kept in search_text (filled by a trigger) and indexed for
-- "contains" searches, so many users can search at once.
-- allow-data-change: fills the new search_text column of existing rows (no existing value changes)
ALTER TABLE fa_records ADD COLUMN search_text TEXT NOT NULL DEFAULT '';

CREATE FUNCTION fa_records_search_text_of(r fa_records) RETURNS TEXT AS $$
  SELECT LOWER(concat_ws(' ', r.fa_code, r.inv_no, to_char(r.inv_date, 'DD/MM/YYYY'), r.po_no, r.cost_center, r.amount::text,
    r.vendor, r.expense_head, r.status, r.plotted_by, to_char(r.plotted_at, 'DD/MM/YYYY'),
    to_char(to_date(r.book_month, 'YYYY-MM'), 'Mon YYYY')))
$$ LANGUAGE sql STABLE;

CREATE FUNCTION fa_records_search_text() RETURNS trigger AS $$
BEGIN
  NEW.search_text := fa_records_search_text_of(NEW);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
-- runs after fa_records_book_month_trg (triggers fire in name order), so book_month is set
CREATE TRIGGER fa_records_search_trg BEFORE INSERT OR UPDATE ON fa_records
  FOR EACH ROW EXECUTE FUNCTION fa_records_search_text();

UPDATE fa_records f SET search_text = fa_records_search_text_of(f);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX fa_records_search_trgm ON fa_records USING gin (search_text gin_trgm_ops)';
  END IF;
END $$;
