-- PO Client Master: Cost Center (filled by users with Export Master + Bulk Edit).
-- Add-only: existing PO rows keep every value; their Cost Center starts blank.
ALTER TABLE po_master ADD COLUMN IF NOT EXISTS cost_center VARCHAR(200) NOT NULL DEFAULT '';
