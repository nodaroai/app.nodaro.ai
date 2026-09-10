-- GPT Image 2.5 (Flare + Sunburst) — text-to-image and image-to-image lanes.
--
-- Four base ids plus their 2K/4K composites = 12 rows. Values MUST match
-- STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts and the `pricing`
-- rows on each MODEL_CATALOG entry (packages/shared/src/model-catalog.ts).
--
-- Base credits derive from KIE's published cost (6 / 10 / 16 KIE credits at
-- 1K / 2K / 4K) through the platform's standard conversion — the same rule the
-- imagen4 family follows. Identical to GPT Image 2 at 1K, cheaper at 2K and 4K.
--
-- `/admin/models` reads model_pricing and nothing else, so without these rows
-- the models are invisible to admins even though they generate correctly.
--
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING (preserves
-- admin overrides).

BEGIN;

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('gpt-image-2-5-flare',             15, true, 'image'),
  ('gpt-image-2-5-flare:2K',          25, true, 'image'),
  ('gpt-image-2-5-flare:4K',          40, true, 'image'),
  ('gpt-image-2-5-flare-i2i',         15, true, 'image'),
  ('gpt-image-2-5-flare-i2i:2K',      25, true, 'image'),
  ('gpt-image-2-5-flare-i2i:4K',      40, true, 'image'),
  ('gpt-image-2-5-sunburst',          15, true, 'image'),
  ('gpt-image-2-5-sunburst:2K',       25, true, 'image'),
  ('gpt-image-2-5-sunburst:4K',       40, true, 'image'),
  ('gpt-image-2-5-sunburst-i2i',      15, true, 'image'),
  ('gpt-image-2-5-sunburst-i2i:2K',   25, true, 'image'),
  ('gpt-image-2-5-sunburst-i2i:4K',   40, true, 'image')
ON CONFLICT (model_identifier) DO NOTHING;

COMMIT;
