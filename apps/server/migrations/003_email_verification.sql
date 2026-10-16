-- Sign-up codes sent by email: an account reaches the Owner only after its email is confirmed.
-- Accounts that existed before count as confirmed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
UPDATE users SET email_verified_at = COALESCE(approved_at, created_at) WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
