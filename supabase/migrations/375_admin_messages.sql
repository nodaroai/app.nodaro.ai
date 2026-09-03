-- 375_admin_messages.sql
-- Admin -> user email, sent from inside Nodaro (Loops transactional API).
--
-- THIS TABLE IS THE RECORD OF TRUTH, not Loops. Loops is a delivery pipe we do
-- not control, cannot query per-user, and whose retention is not ours; every
-- send writes a row here first and updates it with the outcome, so a message an
-- admin sent is provable from our own database even when the provider call was
-- the thing that failed. Failures are rows too -- a send that never left is a
-- fact about the user's history, not an absence.
--
-- Read is EVERY admin, not just the sender (spec): the point of the log is that
-- the next admin to look at this user sees what was already said to them.
-- Write is service-role only -- the route is the only writer, so the rate limit
-- and the template rendering can never be bypassed from a browser session.
-- Mirrors app_reports (261) / picker_catalog_gaps.

CREATE TABLE IF NOT EXISTS admin_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The recipient. SET NULL on user delete so the log survives the account:
  -- what an admin said is a fact about the platform's conduct, and it must not
  -- vanish because the person it was said to closed their account.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The address the message actually went to. NOT a duplicate of the profile:
  -- it is the Loops join key, it is what the row means after user_id is NULL,
  -- and it is the historical truth if the user later changes their email.
  recipient_email TEXT NOT NULL,

  sent_by_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Denormalised for the same reason as recipient_email: an admin who leaves
  -- must not turn every message they ever sent into an anonymous row.
  sent_by_admin_email TEXT,

  -- Which template was used: 'issue_detected' | 'credits_refunded' |
  -- 'general_followup'. Open vocabulary on purpose -- a fourth template is a
  -- code change, not a migration.
  template_id TEXT NOT NULL,
  -- The admin's INPUT, after validation — what they typed, not what was sent.
  -- (The sent form is the rendered HTML in `rendered_body`; keeping the input
  -- separately is what lets a message be re-read, diffed or re-composed later.)
  variables JSONB NOT NULL DEFAULT '{}',

  -- What the recipient saw, as this backend rendered it. Stored because the
  -- Loops template can be edited later: without these, an old row would be
  -- replayed through today's template and misreport history.
  rendered_subject TEXT NOT NULL,
  rendered_body TEXT NOT NULL,

  -- The uploaded screenshot, when there is one (R2 public URL, unguessable
  -- key). Also present inside `variables`; kept as a column because it is the
  -- one variable worth indexing/auditing on its own.
  image_url TEXT,

  -- Loops' own id for the send, when its response carries one. Nullable: the
  -- transactional endpoint is not contractually required to return one, and a
  -- missing id must never cost us the row.
  loops_message_id TEXT,

  -- 'sending' is written BEFORE the provider call and is the reason this row
  -- can be trusted: a process that dies mid-send leaves evidence instead of a
  -- silent gap. A row still 'sending' minutes later means delivery is unknown,
  -- which is a different fact from 'failed' and is displayed as such.
  status TEXT NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'sent', 'failed')),
  -- Why it failed, when it did. Provider text, truncated by the writer.
  error_message TEXT,

  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The user's message history, newest first -- the read the admin UI does.
CREATE INDEX IF NOT EXISTS idx_admin_messages_user_sent
  ON admin_messages (user_id, sent_at DESC);
-- The per-admin daily rate limit counts on this one. Without it the limit
-- check degrades into a full scan on the busiest write path.
CREATE INDEX IF NOT EXISTS idx_admin_messages_admin_sent
  ON admin_messages (sent_by_admin_id, sent_at DESC);

ALTER TABLE admin_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'admin_messages' AND policyname = 'service_role_all') THEN
    CREATE POLICY "service_role_all" ON admin_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  -- SELECT only, and only for admins. Deliberately no policy for the recipient:
  -- this is an internal operations log, and a user reading it would also read
  -- every admin's identity and every draft variable.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'admin_messages' AND policyname = 'admin_read') THEN
    CREATE POLICY "admin_read" ON admin_messages FOR SELECT TO authenticated USING (is_admin());
  END IF;
END $$;

-- Rate limit: messages one admin may send per UTC day. Spec default 50.
-- ON CONFLICT DO NOTHING so a re-apply never resets an operator's tuning.
INSERT INTO app_settings (key, value)
VALUES ('admin_messages_daily_limit', '50'::jsonb)
ON CONFLICT (key) DO NOTHING;
