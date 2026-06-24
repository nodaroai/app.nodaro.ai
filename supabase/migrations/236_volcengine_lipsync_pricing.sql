-- 236_volcengine_lipsync_pricing.sql
-- KIE-hosted, video-input lip-sync (AI dubbing) provider `volcengine-lipsync`
-- (KIE model `volcengine/video-to-video-lip-sync`), billed per second of output.
-- Bucketed via composite identifiers `<provider>:<bucket>s` (15s/30s/60s/120s/300s
-- — see packages/shared/src/lip-sync-pricing.ts), driven by the node's client-side
-- audioDurationSec probe.
--
--   volcengine-lipsync  $0.04/s  (8 KIE cr/sec, identical to kling-avatar)
--
-- At-cost (0% markup, matching kling-avatar + the per-second lip-sync family):
-- credit_cost = ceil(pricePerSec × bucketSec / $0.02) = 2 cr/sec. The lip-sync
-- worker sets no meteredCost, so the reserved bucket is committed verbatim as the
-- charge. The bare row is the back-compat default (300s ceiling) used when no
-- audioDurationSec is supplied.
--
-- ON CONFLICT DO NOTHING preserves any admin overrides set via /admin/models
-- (these identifiers are new, so there is no conflict on first apply).

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('volcengine-lipsync',       600, true, 'lip-sync'),  -- bare = 300s ceiling ($12.00)
  ('volcengine-lipsync:15s',    30, true, 'lip-sync'),  -- $0.60
  ('volcengine-lipsync:30s',    60, true, 'lip-sync'),  -- $1.20
  ('volcengine-lipsync:60s',   120, true, 'lip-sync'),  -- $2.40
  ('volcengine-lipsync:120s',  240, true, 'lip-sync'),  -- $4.80
  ('volcengine-lipsync:300s',  600, true, 'lip-sync')   -- $12.00 — 5-min ceiling
ON CONFLICT (model_identifier) DO NOTHING;
