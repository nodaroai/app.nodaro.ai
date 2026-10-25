-- Topaz upscalers move from KIE to Replicate (decided 2026-10-25).
--
-- Video upscale is metered: a run holds its output-gigapixel ceiling in Topaz
-- units and is charged the units Replicate reports for it, never above the
-- hold. `topaz-video:per-unit` is the price of ONE unit — the hold and the
-- charge are multiples of it. Values MUST match STATIC_CREDIT_COSTS
-- (static-costs-match-migrations.test.ts). The retired `topaz-video` flat row
-- stays for past usage logs.
--
-- Image upscale keeps its rows (`topaz-image-upscale`, `:4K`); a large output
-- is charged `topaz-image-upscale` × its size units when that is higher.
--
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('topaz-video:per-unit', 40, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
