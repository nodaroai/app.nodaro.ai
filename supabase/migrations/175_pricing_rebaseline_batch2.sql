-- 175: Pricing re-baseline batch 2 — the deferred LLM / compute / scrape entries.
--
-- Completes the decision-A re-baseline (migration 174 did the 175 KIE/Replicate-flat
-- markup-baked ids). Values researched from current public provider rates
-- (Anthropic/Google/OpenAI tokens, ElevenLabs, Replicate per-model GPU runs, Apify
***REDACTED-OSS-SCRUB***
--
-- Owner decisions applied: generate-music -> 18 ([figures removed],
-- was a ~6x under-charge); :premium LLM tiers repriced at [figures removed];
-- low-confidence entries (suno-voice-create, seedream-*:high, video-retalking,
-- elevenlabs dubbing/voice-*) HELD at current pending invoice data; pure-compute
-- FFmpeg/pipeline fees kept as small policy floors; bare display-fallback slugs
-- left unchanged (display-only, no runtime revenue).
--
-- Mostly DECREASES (LLM features were over-priced 5-10x; real token cost is sub-cent).
-- Atomic with the STATIC mirror + commit-reserved mechanism (migration 174 PR).
-- Idempotent absolute UPDATEs.

UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = '3d-title';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = '3d-title:economy';
UPDATE model_pricing SET credit_cost = 4 WHERE model_identifier = '3d-title:premium';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'after-effects';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'after-effects:economy';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'after-effects:premium';
UPDATE model_pricing SET credit_cost = 3 WHERE model_identifier = 'ai-writer';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'ai-writer:economy';
UPDATE model_pricing SET credit_cost = 4 WHERE model_identifier = 'ai-writer:premium';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'collect:pick-best-llm';
UPDATE model_pricing SET credit_cost = 5 WHERE model_identifier = 'generate-mask';
UPDATE model_pricing SET credit_cost = 18 WHERE model_identifier = 'generate-music';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'generate-script';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'generate-script:economy';
UPDATE model_pricing SET credit_cost = 3 WHERE model_identifier = 'generate-script:premium';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'image-critic';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'image-critic:economy';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'image-critic:premium';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'image-to-text';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'image-to-text:economy';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'image-to-text:premium';
UPDATE model_pricing SET credit_cost = 4 WHERE model_identifier = 'latentsync';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'llm-chat';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'llm-chat:economy';
UPDATE model_pricing SET credit_cost = 3 WHERE model_identifier = 'llm-chat:premium';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'lottie-overlay';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'lottie-overlay:economy';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'lottie-overlay:premium';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'motion-graphics';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'motion-graphics:economy';
UPDATE model_pricing SET credit_cost = 3 WHERE model_identifier = 'motion-graphics:premium';
UPDATE model_pricing SET credit_cost = 3 WHERE model_identifier = 'prompt-helper:premium';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'qa-check';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'qa-check:economy';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'qa-check:premium';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'reduce:pick-best-llm';
UPDATE model_pricing SET credit_cost = 5 WHERE model_identifier = 'render-video';
UPDATE model_pricing SET credit_cost = 5 WHERE model_identifier = 'sadtalker';
UPDATE model_pricing SET credit_cost = 3 WHERE model_identifier = 'scene-graph-ai';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'scene-graph-ai:economy';
UPDATE model_pricing SET credit_cost = 4 WHERE model_identifier = 'scene-graph-ai:premium';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'scene-helper:anchor_scene_style';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'scene-helper:audit_images';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'scene-helper:fix_continuity';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'scene-helper:optimize_for_model';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'scene-helper:validate_match_cut';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'transcribe';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'translate:premium';
UPDATE model_pricing SET credit_cost = 3 WHERE model_identifier = 'video-composer';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'video-composer:economy';
UPDATE model_pricing SET credit_cost = 4 WHERE model_identifier = 'video-composer:premium';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'web-scrape';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'web-scrape:content-crawler';
UPDATE model_pricing SET credit_cost = 5 WHERE model_identifier = 'web-scrape:content-crawler:site';
UPDATE model_pricing SET credit_cost = 3 WHERE model_identifier = 'web-scrape:google-search';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'web-scrape:instagram';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'web-scrape:tiktok';
