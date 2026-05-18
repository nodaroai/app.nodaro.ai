-- Seedance 2.0 / 2.0 Fast — 1080p resolution tier pricing
-- KIE accepts `resolution: "1080p"` natively on bytedance/seedance-2 and
-- bytedance/seedance-2-fast; migration 087 only seeded 480p / 720p rows so
-- the admin UI couldn't see / override the 1080p price (it was being charged
-- correctly only via the STATIC_CREDIT_COSTS fallback in
-- backend/src/ee/billing/credits.ts). This adds the missing rows.
--
-- Identifier format mirrors 087: seedance-2[-fast]:{tier}:1080p[-ref]
--
-- Pricing math
-- ------------
-- KIE.ai's pricing page is client-rendered and not fetchable from the dev
-- env. Per-second 1080p rates here are extrapolated from the documented
-- 720p rate using a 1.5× factor — the same convention used by every other
-- 720→1080 jump in the codebase (Kling 2.6 6→9 cr/s, Kling 3.0 12→20 cr/s).
-- If KIE's actual published 1080p rate differs, update via /admin/models
-- after launch — ON CONFLICT DO NOTHING preserves any admin overrides.
--
--   seedance-2          720p 41 cr/s      → 1080p 61.5 cr/s
--   seedance-2 (ref)    720p 25 cr/s      → 1080p 37.5 cr/s
--   seedance-2-fast     720p 33 cr/s      → 1080p 49.5 cr/s
--   seedance-2-fast(ref)720p 20 cr/s      → 1080p 30   cr/s
--
-- Nodaro credits = ceil(kie_credits / 4) per migration 087's convention.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  -- Seedance 2.0 — 1080p no video ref (61.5 KIE cr/s)
  ('seedance-2:4s:1080p',       62, true, 'image-to-video'),
  ('seedance-2:8s:1080p',      123, true, 'image-to-video'),
  ('seedance-2:12s:1080p',     185, true, 'image-to-video'),
  ('seedance-2:15s:1080p',     231, true, 'image-to-video'),
  -- Seedance 2.0 — 1080p with video ref (37.5 KIE cr/s)
  ('seedance-2:4s:1080p-ref',   38, true, 'image-to-video'),
  ('seedance-2:8s:1080p-ref',   75, true, 'image-to-video'),
  ('seedance-2:12s:1080p-ref', 113, true, 'image-to-video'),
  ('seedance-2:15s:1080p-ref', 141, true, 'image-to-video'),
  -- Seedance 2.0 Fast — 1080p no video ref (49.5 KIE cr/s)
  ('seedance-2-fast:4s:1080p',       50, true, 'image-to-video'),
  ('seedance-2-fast:8s:1080p',       99, true, 'image-to-video'),
  ('seedance-2-fast:12s:1080p',     149, true, 'image-to-video'),
  ('seedance-2-fast:15s:1080p',     186, true, 'image-to-video'),
  -- Seedance 2.0 Fast — 1080p with video ref (30 KIE cr/s)
  ('seedance-2-fast:4s:1080p-ref',   30, true, 'image-to-video'),
  ('seedance-2-fast:8s:1080p-ref',   60, true, 'image-to-video'),
  ('seedance-2-fast:12s:1080p-ref',  90, true, 'image-to-video'),
  ('seedance-2-fast:15s:1080p-ref', 113, true, 'image-to-video')
ON CONFLICT (model_identifier) DO NOTHING;
