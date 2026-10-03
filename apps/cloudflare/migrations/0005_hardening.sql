-- Cloudflare Workers accept at most 100000 PBKDF2 iterations: new hashes use 100000, older rows keep 120000.
ALTER TABLE users ADD COLUMN password_iterations INTEGER NOT NULL DEFAULT 120000;
ALTER TABLE users ADD COLUMN memory_enabled INTEGER NOT NULL DEFAULT 1;

ALTER TABLE memories ADD COLUMN updated_at INTEGER;
ALTER TABLE files ADD COLUMN extracted_text TEXT;
ALTER TABLE conversations ADD COLUMN project_id TEXT;
ALTER TABLE conversations ADD COLUMN assistant_id TEXT;

-- Projects and assistants created from the desktop app (kind = 'project' | 'assistant').
CREATE TABLE IF NOT EXISTS user_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_items_user_kind_idx ON user_items(user_id, kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS auth_attempts_window_idx ON auth_attempts(window_start);

-- Same index as sessions_expires_at_idx from 0001.
DROP INDEX IF EXISTS sessions_expires_idx;
