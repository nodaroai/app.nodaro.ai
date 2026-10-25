-- 560: retire `seedance` (Seedance 1.5 Pro, KIE `bytedance/seedance-1.5-pro`).
--
-- ByteDance retired the model upstream and KIE retired it on 2026-10-25
-- 12:24 UTC: every request now answers 410. The code drops it from every
-- surface in the same PR (catalog, constants, KIE config, STATIC_CREDIT_COSTS,
-- picker, prompt-wizard, docs), and a stored or sent "seedance" runs - and is
-- priced - as seedance-2-mini (RETIRED_VIDEO_PROVIDERS in @nodaro/shared;
-- owner's decision 2026-10-25). This removes its price rows so /admin/models
-- stops listing a model nothing can run. Idempotent.
DELETE FROM public.model_pricing
WHERE model_identifier IN ('seedance', 'seedance:4s', 'seedance:8s', 'seedance:12s');
