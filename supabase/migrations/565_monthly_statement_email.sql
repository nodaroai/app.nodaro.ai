-- The monthly statement email: a person opts in (Settings, or
-- PATCH /v1/user/settings { monthlyStatementEmail }), and on the 1st the
-- server sends last month's credit figures through Loops
-- (backend/src/ee/notifications/monthly-statement.ts). Default off: a
-- service email nobody asked for is spam.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS monthly_statement_email BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.monthly_statement_email IS
  'Send a statement of last month''s credit usage by email on the 1st. Default false (off).';

-- One row per person and month, claimed BEFORE the email is sent: the unique
-- constraint is the lock, so two ticks (or two replicas) can never send the
-- same statement twice. `pending` = claimed, the send under way; `sent` = the
-- provider accepted it; `unknown` = we stopped waiting, it may have gone (never
-- sent again); `failed` = the provider refused it, retried a few times.
CREATE TABLE IF NOT EXISTS monthly_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- The statement's month, `YYYY-MM` (a UTC calendar month).
  month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- The address it went to, as it was then.
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'unknown', 'failed')),
  -- Sends the provider refused; the sender gives up after a few.
  attempts INTEGER NOT NULL DEFAULT 0,
  message_id TEXT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  UNIQUE (user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_statements_month ON monthly_statements(month);

-- Service role only: the server writes and reads it; a person has no reason to.
-- (No policy for authenticated or anon is what keeps them out; the service
-- role bypasses RLS and the policy below only says so.)
ALTER TABLE monthly_statements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'monthly_statements' AND policyname = 'service_role_all') THEN
    CREATE POLICY "service_role_all" ON monthly_statements FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
