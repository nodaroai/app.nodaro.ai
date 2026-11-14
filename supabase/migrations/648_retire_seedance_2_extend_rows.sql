-- 648: remove the price rows of the retired `seedance-2-extend` id.
--
-- Extend Video's earlier single Seedance id runs - and is priced - as
-- seedance-2-5-extend (RETIRED_VIDEO_PROVIDERS in @nodaro/shared). Every price
-- read rewrites a retired id to the id it runs as before it reads a row, so
-- these rows (the earlier length tiers, seeded by 217 and 288) are read by no
-- run, quote or estimate. This removes them so /admin/models stops listing
-- prices nothing charges. The code drops the same ids from
-- STATIC_CREDIT_COSTS in the same PR. Idempotent.
DELETE FROM public.model_pricing
WHERE model_identifier IN (
  'seedance-2-extend',
  'seedance-2-extend:4s:480p', 'seedance-2-extend:8s:480p', 'seedance-2-extend:12s:480p', 'seedance-2-extend:15s:480p',
  'seedance-2-extend:4s:720p', 'seedance-2-extend:8s:720p', 'seedance-2-extend:12s:720p', 'seedance-2-extend:15s:720p',
  'seedance-2-extend:4s:1080p', 'seedance-2-extend:8s:1080p', 'seedance-2-extend:12s:1080p', 'seedance-2-extend:15s:1080p'
);
