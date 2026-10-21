-- One active sign-in per user: remember when each session was last used and
-- why it ended, so a replaced session can be told apart from an expired one.
ALTER TABLE sessions ADD COLUMN last_seen_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE sessions ADD COLUMN ended_at TIMESTAMP;
ALTER TABLE sessions ADD COLUMN ended_reason VARCHAR(30);   -- 'replaced' = user signed in elsewhere
ALTER TABLE sessions ADD COLUMN user_agent VARCHAR(300) NOT NULL DEFAULT '';
