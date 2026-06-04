-- 187_heygen_sync_lip_sync_pricing.sql
-- Two new Replicate-hosted, video-input lip-sync (dubbing) providers, billed per
-- second of output. Bucketed via composite identifiers `<provider>:<bucket>s`
-- (15s/30s/60s/120s/300s — see packages/shared/src/lip-sync-pricing.ts), driven
-- by the node's client-side audioDurationSec probe.
--
--   heygen-lipsync-precision  $0.0667/s   (heygen/lipsync-precision)
--   lipsync-2-pro             $0.08325/s  (sync/lipsync-2-pro)
--
-- At-cost (0% markup): credit_cost = ceil(pricePerSec × bucketSec / $0.02).
-- The lip-sync worker sets no meteredCost, so the reserved bucket is committed
-- verbatim as the charge. Bare rows are the back-compat default (300s ceiling)
-- used when no audioDurationSec is supplied.
--
-- ON CONFLICT DO NOTHING preserves any admin overrides set via /admin/models
-- (these identifiers are new, so there is no conflict on first apply).

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('heygen-lipsync-precision',       1001, true, 'lip-sync'),  -- bare = 300s ceiling
  ('heygen-lipsync-precision:15s',     51, true, 'lip-sync'),  -- $1.00
  ('heygen-lipsync-precision:30s',    101, true, 'lip-sync'),  -- $2.00
  ('heygen-lipsync-precision:60s',    201, true, 'lip-sync'),  -- $4.00
  ('heygen-lipsync-precision:120s',   401, true, 'lip-sync'),  -- $8.00
  ('heygen-lipsync-precision:300s',  1001, true, 'lip-sync'),  -- $20.01 — 5-min ceiling
  ('lipsync-2-pro',                  1249, true, 'lip-sync'),  -- bare = 300s ceiling
  ('lipsync-2-pro:15s',                63, true, 'lip-sync'),  -- $1.25
  ('lipsync-2-pro:30s',               125, true, 'lip-sync'),  -- $2.50
  ('lipsync-2-pro:60s',               250, true, 'lip-sync'),  -- $5.00
  ('lipsync-2-pro:120s',              500, true, 'lip-sync'),  -- $9.99
  ('lipsync-2-pro:300s',             1249, true, 'lip-sync')   -- $24.98 — 5-min ceiling
ON CONFLICT (model_identifier) DO NOTHING;
