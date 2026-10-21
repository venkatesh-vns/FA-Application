-- One sign-in per user, strictly: a second sign-in is refused while the first
-- browser is open. "Open" = it checked in recently (last_ping_at, any request
-- including the background check-in every minute); a closed browser stops
-- checking in, so its session can be replaced after a few minutes.
ALTER TABLE sessions ADD COLUMN last_ping_at TIMESTAMP NOT NULL DEFAULT NOW();

-- Refused sign-ins, shown to the signed-in user as a notice and kept for audit
CREATE TABLE login_attempts (
  attempt_id   SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  device       VARCHAR(100) NOT NULL DEFAULT '',
  ip           VARCHAR(64) NOT NULL DEFAULT '',
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  notified_at  TIMESTAMP          -- shown to the signed-in user
);
CREATE INDEX login_attempts_user_idx ON login_attempts (user_id, attempt_id);
