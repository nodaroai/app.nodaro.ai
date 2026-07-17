-- Social Connectors v2 (Phase 0) — registry becomes the source of truth.

-- 1. De-hardcode the platform list: the backend provider registry validates
--    platform ids at the app layer (Zod enum derived from the registry), so
--    adding a network no longer needs a migration. The CHECK was last pinned
--    by migration 080 (added 'telegram').
ALTER TABLE social_connections DROP CONSTRAINT IF EXISTS social_connections_platform_check;

-- 2. Between-steps + reconnect surfacing (used by the account picker now and
--    the Phase 1 scheduled-publish worker next):
--    - in_between_steps: connection saved mid-picker (reserved; the Phase 0
--      picker holds pending state in Redis instead of half-rows, but later
--      phases + admin tooling read this flag).
--    - reconnect_needed: set when a refresh fails on a provider whose tokens
--      can't self-heal (capabilities.refresh = "reconnect", Meta family) —
--      the UI surfaces a "Reconnect" chip.
--    - root_internal_id: groups accounts that came from one login (the FB
--      user behind several Pages), enabling "reconnect all" later.
ALTER TABLE social_connections
  ADD COLUMN IF NOT EXISTS in_between_steps BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reconnect_needed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS root_internal_id TEXT;
