-- An invoice reserved for Qty Plotting by one user, so another user does not
-- plot it at the same time. A reservation lapses when not kept alive
-- (last_seen_at) for 10 minutes, e.g. after the browser was closed.
CREATE TABLE qty_locks (
  fa_id         INTEGER PRIMARY KEY REFERENCES fa_records (fa_id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  locked_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX qty_locks_user_idx ON qty_locks (user_id);
