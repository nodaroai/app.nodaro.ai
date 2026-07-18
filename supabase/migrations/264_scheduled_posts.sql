-- Social Connectors Phase 1 — the scheduling calendar.
-- One row per scheduled publish. Delivered by the social-publish BullMQ worker
-- via the 60s scanner (claim CAS queued->publishing before enqueue).

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES social_connections(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  action TEXT NOT NULL,
  -- caption/title/description/tags/privacy/chatId/parseMode etc.
  payload JSONB NOT NULL DEFAULT '{}',
  -- Stable asset refs ONLY: [{type: photo|video, r2Key}] — resolved to fresh
  -- public URLs inside the worker at publish time. Raw/presigned URLs are
  -- rejected at write time (they expire before far-future scheduled_at).
  media JSONB NOT NULL DEFAULT '[]',
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('draft','queued','publishing','published','error','canceled')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  platform_post_id TEXT,
  platform_post_url TEXT,
  job_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sp_owner ON scheduled_posts;
CREATE POLICY sp_owner ON scheduled_posts
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- The scanner's hot path: due queued rows.
CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_posts (scheduled_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_sched_user ON scheduled_posts (user_id, scheduled_at DESC);
