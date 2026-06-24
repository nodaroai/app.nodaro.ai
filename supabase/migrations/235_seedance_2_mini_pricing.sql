-- Pricing for the seedance-2-mini provider (image-to-video / text-to-video /
-- unified generate-video nodes): KIE bytedance/seedance-2-mini, budget tier.
--
-- Per-second billing, 480p/720p ONLY (no 1080p), split by resolution × video-ref:
--   480p:  9.5 KIE cr/s (no-ref) / 6 KIE cr/s (with reference video)
--   720p: 20.5 KIE cr/s (no-ref) / 12.5 KIE cr/s (with reference video)
-- Nodaro credits = ceil(provider_USD / $0.02); KIE cr = USD / $0.005.
-- "-ref" = a reference video was supplied (cheaper tier; "with video" on KIE).
--
-- Values MUST match STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING (preserves
-- admin overrides).

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('seedance-2-mini',             19,  true, 'video'),
  -- 480p no video ref
  ('seedance-2-mini:4s:480p',     10,  true, 'video'),
  ('seedance-2-mini:8s:480p',     19,  true, 'video'),
  ('seedance-2-mini:12s:480p',    29,  true, 'video'),
  ('seedance-2-mini:15s:480p',    36,  true, 'video'),
  -- 480p with video ref
  ('seedance-2-mini:4s:480p-ref',  6,  true, 'video'),
  ('seedance-2-mini:8s:480p-ref', 12,  true, 'video'),
  ('seedance-2-mini:12s:480p-ref',18,  true, 'video'),
  ('seedance-2-mini:15s:480p-ref',23,  true, 'video'),
  -- 720p no video ref
  ('seedance-2-mini:4s:720p',     21,  true, 'video'),
  ('seedance-2-mini:8s:720p',     41,  true, 'video'),
  ('seedance-2-mini:12s:720p',    62,  true, 'video'),
  ('seedance-2-mini:15s:720p',    77,  true, 'video'),
  -- 720p with video ref
  ('seedance-2-mini:4s:720p-ref', 13,  true, 'video'),
  ('seedance-2-mini:8s:720p-ref', 25,  true, 'video'),
  ('seedance-2-mini:12s:720p-ref',38,  true, 'video'),
  ('seedance-2-mini:15s:720p-ref',47,  true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
