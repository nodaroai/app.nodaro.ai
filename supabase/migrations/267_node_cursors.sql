-- Durable per-node polling cursors.
--
-- Source nodes that poll an external feed need to remember "where did I get to"
-- ACROSS runs. The editor could always do this (it writes the cursor back into
-- the node's data and autosaves), but a scheduled run has no editor: the
-- orchestrator read the cursor and had nowhere to write the new one back, so
-- every tick refetched the same items. For Telegram Channel Feed that meant a
-- "Schedule Trigger -> Feed -> Publish" chain republishing the same posts to a
-- real audience on every interval.
--
-- Writing the cursor back into `workflows.nodes` was rejected deliberately: a
-- background job patching the document the user is editing races the canvas and
-- can silently drop their edits. The cursor is SERVER state, so it lives in
-- server-owned storage — the same call the repo already made for triggers with
-- `last_triggered_at`.
--
-- Deliberately generic (`cursor_value` + `kind`, not `last_seen_post_id`): the
-- next polling source (RSS, another channel, a mailbox) reuses this table
-- instead of adding a column each time.

CREATE TABLE IF NOT EXISTS node_cursors (
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  -- Canvas node id — a string key inside the workflow document, not a DB row.
  node_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- What the cursor counts, so one table can serve unrelated pollers.
  kind TEXT NOT NULL,
  -- Monotonic position. BIGINT because Telegram post ids grow without bound and
  -- the next poller may use a millisecond timestamp.
  cursor_value BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workflow_id, node_id)
);

ALTER TABLE node_cursors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS node_cursors_owner ON node_cursors;
CREATE POLICY node_cursors_owner ON node_cursors
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- The read is always by (workflow_id, node_id), which the primary key covers.
-- This one supports per-user cleanup and admin inspection.
CREATE INDEX IF NOT EXISTS idx_node_cursors_user ON node_cursors (user_id, updated_at DESC);
