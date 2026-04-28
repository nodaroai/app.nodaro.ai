-- Seed all model_pricing rows that exist in STATIC_CREDIT_COSTS but were
-- never inserted into the DB. Without these rows the /admin/models and
-- /admin/llm-models pages do not display the model and admins cannot
-- override pricing. Costs come from backend/src/billing/credits.ts.
--
-- Audit method: diff STATIC_CREDIT_COSTS keys vs existing model_pricing
-- INSERTs across all migrations. 54 missing identifiers + 3 translate
-- entries (translate is referenced by LlmFeature but had no static cost).
--
-- Uses ON CONFLICT DO NOTHING — never overwrites admin-customized rows.

-- ── Image Generation (GPT Image 2 + composite identifiers) ──────────
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('gpt-image-2',          2, true, 'image'),
  ('gpt-image-2:2K',       4, true, 'image'),
  ('gpt-image-2:4K',       7, true, 'image'),
  ('gpt-image-2-i2i',      2, true, 'image'),
  ('gpt-image-2-i2i:2K',   4, true, 'image'),
  ('gpt-image-2-i2i:4K',   7, true, 'image'),
  -- Generic image-op aliases (estimation fallbacks by node.type)
  ('image-to-image',       2, true, 'image'),
  ('edit-image',           2, true, 'image'),
  ('modify-image',         2, true, 'image'),
  ('upscale-image',        1, true, 'image'),
  ('remove-background',    1, true, 'image')
ON CONFLICT (model_identifier) DO NOTHING;

-- ── Video Generation (Kling 3.0 composite, Wan Flash) ───────────────
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('kling-3.0:5s',          43, true, 'video'),
  ('kling-3.0:10s',         86, true, 'video'),
  ('kling-3.0:15s',        128, true, 'video'),
  ('kling-3.0:5s:audio',    63, true, 'video'),
  ('kling-3.0:10s:audio',  126, true, 'video'),
  ('kling-3.0:15s:audio',  189, true, 'video'),
  ('wan-flash',             13, true, 'video'),
  -- Lip-sync model variants
  ('latentsync',             5, true, 'video'),
  ('wav2lip',                1, true, 'video'),
  ('video-retalking',       20, true, 'video'),
  ('sadtalker',              9, true, 'video'),
  -- Generic video aliases (estimation fallbacks by node.type)
  ('lip-sync',              13, true, 'video'),
  ('video-upscale',         19, true, 'video'),
  ('extend-video',          40, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;

-- ── Audio / Processing aliases ──────────────────────────────────────
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('transcribe',             4, true, 'audio'),
  ('combine-audio',          1, true, 'processing'),
  ('extract-frame',          1, true, 'processing'),
  ('transcode-video',        1, true, 'processing'),
  ('trim-audio',             1, true, 'processing'),
  ('split-media',            2, true, 'processing')
ON CONFLICT (model_identifier) DO NOTHING;

-- ── LLM features (llm-chat tiered, translate utility) ───────────────
-- llm-chat = user-facing chat node; translate = internal utility.
-- Translate is added so admins can see the cost it would incur if
-- it were billed separately (currently it is bundled into the parent
-- generation route's credit charge).
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('llm-chat',               5, true, 'other'),
  ('llm-chat:economy',       3, true, 'other'),
  ('llm-chat:premium',      15, true, 'other'),
  ('translate',              1, true, 'other'),
  ('translate:economy',      1, true, 'other'),
  ('translate:premium',      3, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;

-- ── Web Scrape (Apify + RSS) ────────────────────────────────────────
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('web-scrape',                          5, true, 'other'),
  ('web-scrape:google-search',            2, true, 'other'),
  ('web-scrape:content-crawler',          3, true, 'other'),
  ('web-scrape:content-crawler:site',    10, true, 'other'),
  ('web-scrape:instagram',                5, true, 'other'),
  ('web-scrape:tiktok',                   5, true, 'other'),
  ('web-scrape:rss',                      1, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;

-- ── Entity nodes (character / object / location ref image) ─────────
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('character',              2, true, 'other'),
  ('object',                 2, true, 'other'),
  ('location',               2, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;

-- ── Social publish (per platform aliases — actual charge is 1 cr) ──
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('instagram-post',         1, true, 'other'),
  ('tiktok-post',            1, true, 'other'),
  ('youtube-upload',         1, true, 'other'),
  ('linkedin-post',          1, true, 'other'),
  ('x-post',                 1, true, 'other'),
  ('facebook-post',          1, true, 'other'),
  ('telegram-post',          1, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;

-- ── Internal / zero-cost nodes (router, save, component) ────────────
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('router',                 0, true, 'other'),
  ('save-to-storage',        0, true, 'other'),
  ('component',              0, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
