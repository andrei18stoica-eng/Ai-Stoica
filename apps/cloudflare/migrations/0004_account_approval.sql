-- Accounts that existed before approval was enforced keep working.
UPDATE users SET status='active', approved_at=COALESCE(approved_at, created_at) WHERE status='pending' AND approved_at IS NULL;

-- Failed sign-in counter per IP (password guessing protection).
CREATE TABLE IF NOT EXISTS auth_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
