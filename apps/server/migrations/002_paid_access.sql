-- 0.7.17: paid AI (GPT and Claude through their APIs) for one account, either offered free by the Owner (paid_gift)
-- or paid by the account until a date (paid_until, set when a payment is confirmed). The free models stay available
-- to every approved account.
ALTER TABLE users ADD COLUMN IF NOT EXISTS paid_gift BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS paid_until TIMESTAMPTZ;
