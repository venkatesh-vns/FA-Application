-- Version control: every deployment of a version to this environment
-- (staging or production), and on staging the approval for production.
CREATE TABLE app_releases (
  release_id    SERIAL PRIMARY KEY,
  version       VARCHAR(20) NOT NULL,
  environment   VARCHAR(20) NOT NULL,
  status        VARCHAR(12) NOT NULL DEFAULT 'deployed' CHECK (status IN ('deployed', 'failed', 'rolled back', 'replaced')),
  deployed_by   VARCHAR(150) NOT NULL DEFAULT '',
  deployed_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  backup_file   VARCHAR(500) NOT NULL DEFAULT '',
  migrations    TEXT NOT NULL DEFAULT '',          -- database changes applied by this deployment
  notes         TEXT NOT NULL DEFAULT '',
  approved_by   VARCHAR(150),                      -- staging: approved for production
  approved_at   TIMESTAMP,
  approval_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX app_releases_version_idx ON app_releases (environment, version);
