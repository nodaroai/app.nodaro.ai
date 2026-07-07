-- 221_fal_sync_lipsync_v3.sql
-- fal.ai-hosted, video-input lip-sync (dubbing) provider `sync-lipsync-v3`
-- (fal endpoint fal-ai/sync-lipsync/v3), billed per second of output. Bucketed
-- via composite identifiers `<provider>:<bucket>s` (15s/30s/60s/120s/300s — see
-- packages/shared/src/lip-sync-pricing.ts), driven by the node's client-side
-- audioDurationSec probe.
--
--   sync-lipsync-v3 (fal-ai/sync-lipsync/v3) — billed per second of output.
--
-- At-cost (0% markup), bucketed to the durations below. The lip-sync worker sets
-- no meteredCost, so the reserved bucket is committed verbatim as the charge. The
-- bare row is the back-compat default (300s ceiling) used when no audioDurationSec
-- is supplied.
--
-- ON CONFLICT DO NOTHING preserves any admin overrides set via /admin/models
-- (these identifiers are new, so there is no conflict on first apply).

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('sync-lipsync-v3',       2000, true, 'lip-sync'),  -- bare = 300s ceiling
  ('sync-lipsync-v3:15s',    100, true, 'lip-sync'),
  ('sync-lipsync-v3:30s',    200, true, 'lip-sync'),
  ('sync-lipsync-v3:60s',    400, true, 'lip-sync'),
  ('sync-lipsync-v3:120s',   800, true, 'lip-sync'),
  ('sync-lipsync-v3:300s',  2000, true, 'lip-sync')   -- 5-min ceiling
ON CONFLICT (model_identifier) DO NOTHING;
