-- Sync model_pricing table with all STATIC_CREDIT_COSTS entries.
-- Fixes stale initial seed values and adds ~100 missing models so the
-- admin /admin/models page shows every model and billing charges correctly.
--
-- Uses ON CONFLICT to upsert: existing rows get their credit_cost updated,
-- new rows are inserted. Category is set for new rows only (DO NOT overwrite
-- admin-customized categories on existing rows).

-- ══════════════════════════════════════════════════════════════════════════
-- Image Generation
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('nano-banana',          2,  true, 'image'),
  ('nano-banana-2',        3,  true, 'image'),
  ('nano-banana-2:2K',     4,  true, 'image'),
  ('nano-banana-2:4K',     6,  true, 'image'),
  ('nano-banana-pro',      6,  true, 'image'),
  ('nano-banana-pro:4K',   8,  true, 'image'),
  ('flux',                 2,  true, 'image'),
  ('flux:2K',              3,  true, 'image'),
  ('grok',                 2,  true, 'image'),
  ('gpt-image',            2,  true, 'image'),
  ('gpt-image:high',       7,  true, 'image'),
  ('imagen4',              3,  true, 'image'),
  ('imagen4-fast',         2,  true, 'image'),
  ('imagen4-ultra',        4,  true, 'image'),
  ('ideogram',             6,  true, 'image'),
  ('ideogram:TURBO',       4,  true, 'image'),
  ('ideogram:QUALITY',     8,  true, 'image'),
  ('qwen',                 2,  true, 'image'),
  ('seedream',             3,  true, 'image'),
  ('seedream:high',        4,  true, 'image'),
  ('seedream-5-lite',      2,  true, 'image'),
  ('seedream-5-lite:high', 5,  true, 'image'),
  ('flux-flex',            5,  true, 'image'),
  ('flux-flex:2K',         8,  true, 'image'),
  ('z-image',              1,  true, 'image'),
  ('flux-kontext',         2,  true, 'image'),
  ('flux-kontext-max',     4,  true, 'image')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- ══════════════════════════════════════════════════════════════════════════
-- Image Editing
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('recraft-upscale',          1,  true, 'image'),
  ('recraft-remove-bg',        1,  true, 'image'),
  ('nano-banana-edit',         2,  true, 'image'),
  ('topaz-image-upscale',      4,  true, 'image'),
  ('topaz-image-upscale:4K',   7,  true, 'image'),
  ('topaz-image-upscale:8K',  13,  true, 'image'),
  ('grok-upscale',             4,  true, 'image')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- ══════════════════════════════════════════════════════════════════════════
-- Image-to-Image
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('flux-i2i',                 5,  true, 'image'),
  ('flux-i2i:2K',              8,  true, 'image'),
  ('flux-pro-i2i',             2,  true, 'image'),
  ('flux-pro-i2i:2K',          3,  true, 'image'),
  ('grok-i2i',                 2,  true, 'image'),
  ('gpt-image-i2i',            2,  true, 'image'),
  ('gpt-image-i2i:high',       7,  true, 'image'),
  ('ideogram-edit',            6,  true, 'image'),
  ('ideogram-edit:TURBO',      4,  true, 'image'),
  ('ideogram-edit:QUALITY',    8,  true, 'image'),
  ('ideogram-remix',           6,  true, 'image'),
  ('ideogram-remix:TURBO',     4,  true, 'image'),
  ('ideogram-remix:QUALITY',   8,  true, 'image'),
  ('ideogram-reframe',         3,  true, 'image'),
  ('ideogram-reframe:TURBO',   2,  true, 'image'),
  ('ideogram-reframe:QUALITY', 4,  true, 'image'),
  ('ideogram-v3',              2,  true, 'image'),
  ('ideogram-v3:TURBO',        1,  true, 'image'),
  ('ideogram-v3:QUALITY',      3,  true, 'image'),
  ('qwen-i2i',                 2,  true, 'image'),
  ('qwen-edit',                2,  true, 'image'),
  ('seedream-edit',            3,  true, 'image'),
  ('seedream-edit:high',       4,  true, 'image'),
  ('seedream-5-lite-i2i',      2,  true, 'image'),
  ('seedream-5-lite-i2i:high', 5,  true, 'image')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- ══════════════════════════════════════════════════════════════════════════
-- Video Generation (I2V / T2V)
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('minimax',           18, true, 'video'),
  ('veo3',              79, true, 'video'),
  ('veo3.1',            19, true, 'video'),
  ('kling',             18, true, 'video'),
  ('kling-turbo',       14, true, 'video'),
  ('kling-3.0',         63, true, 'video'),
  ('grok-i2v',           7, true, 'video'),
  ('sora2-pro',         47, true, 'video'),
  ('seedance',          32, true, 'video'),
  ('wan-i2v',           22, true, 'video'),
  ('wan-turbo',         13, true, 'video'),
  ('hailuo-2.3-pro',   15, true, 'video'),
  ('hailuo-2.3',       10, true, 'video'),
  ('hailuo-standard',  10, true, 'video'),
  ('sora2',            10, true, 'video'),
  ('bytedance-lite',   16, true, 'video'),
  ('bytedance-pro',    22, true, 'video'),
  ('bytedance-pro-fast', 19, true, 'video'),
  ('kling-master',     50, true, 'video'),
  ('runway-kie',        4, true, 'video'),
  ('wan-t2v',          33, true, 'video'),
  ('wan-turbo-t2v',    25, true, 'video')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- ══════════════════════════════════════════════════════════════════════════
-- Video Extend / Upscale / Watermark
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('sora-watermark-remove',  4, true, 'video'),
  ('veo-extend',            19, true, 'video'),
  ('veo-extend:quality',    79, true, 'video'),
  ('runway-extend',         32, true, 'video'),
  ('veo-1080p',              2, true, 'video'),
  ('veo-4k',                38, true, 'video')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- ══════════════════════════════════════════════════════════════════════════
-- Video-to-Video
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('wan',            22, true, 'video'),
  ('luma-modify',    32, true, 'video'),
  ('runway-aleph',   35, true, 'video'),
  ('topaz-video',    19, true, 'video')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- ══════════════════════════════════════════════════════════════════════════
-- Motion Transfer (duration-tiered entries already in 058, update base values)
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('kling-motion',     19, true, 'video'),
  -- Wan Animate
  ('wan-animate-move',          2, true, 'video'),
  ('wan-animate-move:580p',     3, true, 'video'),
  ('wan-animate-move:720p',     4, true, 'video'),
  ('wan-animate-replace',       2, true, 'video'),
  ('wan-animate-replace:580p',  3, true, 'video'),
  ('wan-animate-replace:720p',  4, true, 'video')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- ══════════════════════════════════════════════════════════════════════════
-- Lip Sync
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('kling-avatar',      13, true, 'video'),
  ('kling-avatar-pro',  25, true, 'video'),
  ('hailuo-avatar',     19, true, 'video'),
  ('infinitalk',        19, true, 'audio')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- ══════════════════════════════════════════════════════════════════════════
-- Audio / TTS / Music
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('elevenlabs-v3',             4, true, 'audio'),
  ('elevenlabs-turbo',          2, true, 'audio'),
  ('elevenlabs-multilingual',   4, true, 'audio'),
  ('elevenlabs',                2, true, 'audio'),
  ('elevenlabs-sfx',            1, true, 'audio'),
  ('tangoflux',                 4, true, 'audio'),
  ('suno',                      4, true, 'audio'),
  ('suno-v5',                   4, true, 'audio'),
  ('suno-generate',             4, true, 'audio'),
  ('suno-cover',                4, true, 'audio'),
  ('suno-extend',               4, true, 'audio'),
  ('suno-lyrics',               1, true, 'audio'),
  ('suno-separate',             4, true, 'audio'),
  ('suno-separate-stem',       16, true, 'audio'),
  ('suno-music-video',          1, true, 'audio'),
  ('suno-mashup',               4, true, 'audio'),
  ('suno-replace-section',      2, true, 'audio'),
  ('suno-style-boost',          1, true, 'audio'),
  ('suno-add-instrumental',     4, true, 'audio'),
  ('suno-add-vocals',           4, true, 'audio'),
  ('suno-convert-wav',          1, true, 'audio'),
  ('suno-upload-extend',        4, true, 'audio'),
  ('musicgen',                  7, true, 'audio'),
  ('lyria',                     7, true, 'audio'),
  ('bark',                      7, true, 'audio'),
  ('elevenlabs-isolation',      1, true, 'audio'),
  ('whisper',                   4, true, 'audio'),
  ('incredibly-fast-whisper',   4, true, 'audio'),
  ('elevenlabs-stt',            2, true, 'audio'),
  ('elevenlabs-dialogue',       5, true, 'audio'),
  ('voice-clone',               5, true, 'audio'),
  ('elevenlabs-voice-changer',  4, true, 'audio'),
  ('elevenlabs-dubbing',        8, true, 'audio'),
  ('elevenlabs-voice-remix',    4, true, 'audio'),
  ('elevenlabs-voice-design',   5, true, 'audio'),
  ('elevenlabs-forced-alignment', 3, true, 'audio')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- ══════════════════════════════════════════════════════════════════════════
-- Sora Storyboard (already in 057, ensure correct values)
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('sora-storyboard',     47, true, 'video'),
  ('sora-storyboard:15',  85, true, 'video'),
  ('sora-storyboard:25',  85, true, 'video')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- ══════════════════════════════════════════════════════════════════════════
-- Speech-to-Video (already in 057, ensure correct values)
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('speech-to-video',       4, true, 'video'),
  ('speech-to-video:580p',  6, true, 'video'),
  ('speech-to-video:720p',  8, true, 'video')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- ══════════════════════════════════════════════════════════════════════════
-- LLM / Composition
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('ai-writer',        5, true, 'other'),
  ('scene-graph-ai',  10, true, 'other'),
  ('video-composer',  10, true, 'other'),
  ('after-effects',   10, true, 'other'),
  ('lottie-overlay',  10, true, 'other'),
  ('3d-title',        15, true, 'other'),
  ('motion-graphics', 10, true, 'other'),
  ('composite',        0, true, 'other'),
  ('sub-workflow',     0, true, 'other'),
  ('social-publish',   1, true, 'other')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- ══════════════════════════════════════════════════════════════════════════
-- Processing / Replicate
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('topaz',        1, true, 'processing'),
  ('ffmpeg',       0, true, 'processing'),
  ('render-video', 15, true, 'processing'),
  ('runway',       20, true, 'video'),
  ('pika',         20, true, 'video'),
  ('sora',         20, true, 'video')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- ══════════════════════════════════════════════════════════════════════════
-- Node-type fallbacks (for workflow estimation)
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('generate-script',     10, true, 'other'),
  ('generate-image',       2, true, 'other'),
  ('image-to-video',      20, true, 'other'),
  ('video-to-video',      25, true, 'other'),
  ('text-to-video',       20, true, 'other'),
  ('text-to-speech',       4, true, 'other'),
  ('qa-check',             5, true, 'other'),
  ('combine-videos',       0, true, 'processing'),
  ('merge-video-audio',    0, true, 'processing'),
  ('add-captions',         0, true, 'processing'),
  ('resize-video',         0, true, 'processing'),
  ('extract-audio',        0, true, 'processing'),
  ('mix-audio',            0, true, 'processing'),
  ('adjust-volume',        0, true, 'processing'),
  ('trim-video',           0, true, 'processing'),
  ('speed-ramp',           0, true, 'processing'),
  ('loop-video',           0, true, 'processing'),
  ('fade-video',           0, true, 'processing'),
  ('generate-music',       4, true, 'other'),
  ('text-to-audio',        1, true, 'other'),
  ('audio-isolation',      1, true, 'other'),
  ('text-to-dialogue',     5, true, 'other'),
  ('image-to-text',        5, true, 'other'),
  ('voice-changer',        4, true, 'other'),
  ('dubbing',              8, true, 'other'),
  ('voice-remix',          4, true, 'other'),
  ('voice-design',         5, true, 'other'),
  ('forced-alignment',     3, true, 'other'),
  ('social-media-format',  0, true, 'processing')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
