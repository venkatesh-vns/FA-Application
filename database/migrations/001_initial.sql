-- FA Management System - PostgreSQL schema.
-- One table per sheet of the Google Sheets workbook used by Code.gs:
--   Users                      -> users (+ sessions, replacing CacheService)
--   Raw Data                   -> fa_records
--   Qty Plotting               -> qty_lines
--   LWM Tally                  -> lwm_tally
--   Product Master             -> products
--   Ledger Master              -> ledgers
--   Activity Log               -> activity_log
--   Client Master              -> client_master
--   Branch Master              -> branch_master
--   Category Master            -> category_master
--   Description Master         -> description_master
--   PO Master                  -> po_master
--   Client Cost Center Master  -> client_cc_master
--   Script Properties FA_CODE_COUNTER_<MMMYYYY> -> fa_code_counters
--   'FA Management Archive' spreadsheet          -> fa_records_archive, qty_lines_archive

-- ============================================================
-- Users and sessions
-- ============================================================
CREATE TABLE users (
  user_id        SERIAL PRIMARY KEY,
  username       VARCHAR(100) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,      -- bcrypt; the sheet kept plain text
  name           VARCHAR(150) NOT NULL,
  role           VARCHAR(10)  NOT NULL DEFAULT 'User' CHECK (role IN ('Admin', 'User')),
  active         VARCHAR(3)   NOT NULL DEFAULT 'Yes' CHECK (active IN ('Yes', 'No')),
  email          VARCHAR(255),
  department     VARCHAR(150),
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP
);
CREATE UNIQUE INDEX users_username_uq ON users (LOWER(username));

-- Login sessions (createSession_ / getSession_ / logout): 6 hours by default
CREATE TABLE sessions (
  token_hash  CHAR(64) PRIMARY KEY,           -- SHA-256 of the token the browser holds
  user_id     INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMP NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- ============================================================
-- Raw Data and Qty Plotting
-- ============================================================

-- Next FA Code number per month, e.g. period 'SEP2026' -> 25
CREATE TABLE fa_code_counters (
  period       VARCHAR(7) PRIMARY KEY,
  last_number  INTEGER NOT NULL
);

CREATE TABLE fa_records (
  fa_id         SERIAL PRIMARY KEY,
  fa_code       VARCHAR(20)  NOT NULL UNIQUE,
  inv_no        VARCHAR(200) NOT NULL,
  inv_date      DATE         NOT NULL,
  po_no         VARCHAR(200) NOT NULL,
  cost_center   VARCHAR(200) NOT NULL,
  amount        NUMERIC(15, 2) NOT NULL CHECK (amount <> 0),  -- negative = credit note / reversal
  vendor        VARCHAR(300) NOT NULL,
  expense_head  VARCHAR(300) NOT NULL,
  narration     TEXT NOT NULL DEFAULT '',
  status        VARCHAR(10)  NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed')),
  plotted_at    TIMESTAMP,                  -- 'Qty Plotting Created Date'
  plotted_by    VARCHAR(150),               -- 'Qty Plotted By'
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX fa_records_status_idx ON fa_records (status);
CREATE INDEX fa_records_date_idx ON fa_records (inv_date);

CREATE TABLE qty_lines (
  line_id             SERIAL PRIMARY KEY,
  fa_id               INTEGER NOT NULL REFERENCES fa_records (fa_id) ON DELETE CASCADE,
  line_no             INTEGER NOT NULL,
  product             VARCHAR(300) NOT NULL,
  quantity            NUMERIC(14, 4) NOT NULL,
  taggable            VARCHAR(15) NOT NULL DEFAULT '',  -- 'Taggable' | 'Non Taggable' ('' only in imported old rows)
  unit_price          NUMERIC(18, 6) NOT NULL,
  product_amount      NUMERIC(15, 2) NOT NULL,
  gst_pct             NUMERIC(6, 2) NOT NULL DEFAULT 0,
  against_invoice_no  VARCHAR(200) NOT NULL DEFAULT '',
  against_asset_code  VARCHAR(200) NOT NULL DEFAULT '',
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX qty_lines_fa_idx ON qty_lines (fa_id, line_no);

-- Archive (archiveOldRecords): same columns, kept out of the live screens
CREATE TABLE fa_records_archive (
  fa_id         INTEGER PRIMARY KEY,
  fa_code       VARCHAR(20)  NOT NULL UNIQUE,
  inv_no        VARCHAR(200) NOT NULL,
  inv_date      DATE         NOT NULL,
  po_no         VARCHAR(200) NOT NULL,
  cost_center   VARCHAR(200) NOT NULL,
  amount        NUMERIC(15, 2) NOT NULL,
  vendor        VARCHAR(300) NOT NULL,
  expense_head  VARCHAR(300) NOT NULL,
  narration     TEXT NOT NULL DEFAULT '',
  status        VARCHAR(10)  NOT NULL,
  plotted_at    TIMESTAMP,
  plotted_by    VARCHAR(150),
  created_at    TIMESTAMP NOT NULL,
  updated_at    TIMESTAMP NOT NULL,
  archived_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  archived_by   VARCHAR(150)
);

CREATE TABLE qty_lines_archive (
  line_id             INTEGER PRIMARY KEY,
  fa_id               INTEGER NOT NULL REFERENCES fa_records_archive (fa_id) ON DELETE CASCADE,
  line_no             INTEGER NOT NULL,
  product             VARCHAR(300) NOT NULL,
  quantity            NUMERIC(14, 4) NOT NULL,
  taggable            VARCHAR(15) NOT NULL,
  unit_price          NUMERIC(18, 6) NOT NULL,
  product_amount      NUMERIC(15, 2) NOT NULL,
  gst_pct             NUMERIC(6, 2) NOT NULL DEFAULT 0,
  against_invoice_no  VARCHAR(200) NOT NULL DEFAULT '',
  against_asset_code  VARCHAR(200) NOT NULL DEFAULT '',
  created_at          TIMESTAMP NOT NULL,
  updated_at          TIMESTAMP NOT NULL
);

-- ============================================================
-- LWM (Tally ledger summary), Ledger Master, Product Master
-- ============================================================
CREATE TABLE lwm_tally (
  lwm_id        SERIAL PRIMARY KEY,
  expense_head  VARCHAR(300) NOT NULL,      -- 'Expanse Head' in the template
  amount        NUMERIC(15, 2) NOT NULL,
  uploaded_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE ledgers (
  ledger_id     SERIAL PRIMARY KEY,
  expense_head  VARCHAR(300) NOT NULL,
  mapping       VARCHAR(15) NOT NULL CHECK (mapping IN ('Taggable', 'Non Taggable')),
  active        VARCHAR(3)  NOT NULL DEFAULT 'Yes' CHECK (active IN ('Yes', 'No')),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP
);
CREATE UNIQUE INDEX ledgers_head_uq ON ledgers (LOWER(expense_head));

CREATE TABLE products (
  product_id    SERIAL PRIMARY KEY,
  product_name  VARCHAR(300) NOT NULL
);
CREATE UNIQUE INDEX products_name_uq ON products (LOWER(product_name));

-- ============================================================
-- Masters (getMasterConfig_): free-text columns as in the sheets;
-- only the first column is required
-- ============================================================
CREATE TABLE client_master (
  id           SERIAL PRIMARY KEY,
  client_name  VARCHAR(300) NOT NULL,
  client_code  VARCHAR(100) NOT NULL DEFAULT '',
  status       VARCHAR(50)  NOT NULL DEFAULT '',
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP
);

CREATE TABLE branch_master (
  id           SERIAL PRIMARY KEY,
  cost_center  VARCHAR(200) NOT NULL,
  branch       VARCHAR(300) NOT NULL DEFAULT '',
  branch_code  VARCHAR(100) NOT NULL DEFAULT '',
  location     VARCHAR(300) NOT NULL DEFAULT '',
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP
);

CREATE TABLE category_master (
  id                 SERIAL PRIMARY KEY,
  expense_head       VARCHAR(300) NOT NULL,
  category_level_1   VARCHAR(300) NOT NULL DEFAULT '',
  category_level_2   VARCHAR(300) NOT NULL DEFAULT '',
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP
);

CREATE TABLE description_master (
  id                     SERIAL PRIMARY KEY,
  product_description    VARCHAR(300) NOT NULL,
  expense_head           VARCHAR(300) NOT NULL DEFAULT '',
  asset_description_one  VARCHAR(300) NOT NULL DEFAULT '',  -- always = Expense Head
  asset_description_two  VARCHAR(300) NOT NULL DEFAULT '',
  category_level_2       VARCHAR(300) NOT NULL DEFAULT '',
  created_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP
);

CREATE TABLE po_master (
  id                 SERIAL PRIMARY KEY,
  po_no              VARCHAR(200) NOT NULL,
  po_date            VARCHAR(50)  NOT NULL DEFAULT '',
  client_as_per_po   VARCHAR(300) NOT NULL DEFAULT '',
  client_as_per_pmo  VARCHAR(300) NOT NULL DEFAULT '',
  status             VARCHAR(50)  NOT NULL DEFAULT '',
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP
);

CREATE TABLE client_cc_master (
  id                 SERIAL PRIMARY KEY,
  client_as_per_pmo  VARCHAR(300) NOT NULL,
  cost_center        VARCHAR(200) NOT NULL DEFAULT '',
  status             VARCHAR(50)  NOT NULL DEFAULT '',
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP
);

-- ============================================================
-- Activity Log
-- ============================================================
CREATE TABLE activity_log (
  log_id        BIGSERIAL PRIMARY KEY,
  logged_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  username      VARCHAR(100) NOT NULL DEFAULT '',
  name          VARCHAR(150) NOT NULL DEFAULT '',
  action        VARCHAR(100) NOT NULL,
  module        VARCHAR(100) NOT NULL DEFAULT '',
  fa_code       VARCHAR(20)  NOT NULL DEFAULT '',
  inv_no        VARCHAR(200) NOT NULL DEFAULT '',
  expense_head  VARCHAR(300) NOT NULL DEFAULT '',
  details       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX activity_log_at_idx ON activity_log (logged_at DESC);
