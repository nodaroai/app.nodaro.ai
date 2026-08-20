-- Restore 16 model_pricing rows that drifted from the intended prices.
--
-- Adjudicated 2026-07-30 (credit re-denomination Phase 0 parity baseline —
-- recorded in the internal parity baseline).
-- The DB wins at runtime (getModelCreditBaseCost takes credit_cost verbatim),
-- so these rows were LIVE mispricing:
--
--  * 11 FFmpeg/utility nodes billed 0 — ruled drift, not policy: they are
--    intended to charge their platform-compute prices (1-3 cr).
--  * audio-isolation billed 1 vs the intended 8 worst-case reserve — a real
--    $0.075 job needs 4 cr at commit, so 1 under-reserves.
--  * infinitalk billed 34 — below KIE's current price (168 KIE cr = $0.84
--    => 42 cr at ceil(kie/4)); every run under-recovered ~$0.16.
--  * text-to-dialogue billed 5 vs the intended 4 (every observed job costs
--    $0.05 => 3 cr actual; 4 covers it).
--  * image-to-video / text-to-video bare ids are fallback worst-case reserves
--    that fire only when no duration-composite matches. Both the old DB value
--    (20) and the old code value (25) sat BELOW observed composite actuals
--    (29-47), so both sides are raised to 50 (ruled 2026-07-30). Commit
--    meters down to the real charge as always.

-- FFmpeg / utility nodes (platform compute)
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'adjust-volume';
UPDATE model_pricing SET credit_cost = 3 WHERE model_identifier = 'combine-videos';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'fade-video';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'ffmpeg';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'loop-video';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'merge-video-audio';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'mix-audio';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'resize-video';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'social-media-format';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'speed-ramp';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'trim-video';

-- Provider-backed corrections
UPDATE model_pricing SET credit_cost = 8  WHERE model_identifier = 'audio-isolation';
UPDATE model_pricing SET credit_cost = 4  WHERE model_identifier = 'text-to-dialogue';
UPDATE model_pricing SET credit_cost = 42 WHERE model_identifier = 'infinitalk';

-- Bare-id fallback reserves, re-sized to cover observed composite actuals
UPDATE model_pricing SET credit_cost = 50 WHERE model_identifier = 'image-to-video';
UPDATE model_pricing SET credit_cost = 50 WHERE model_identifier = 'text-to-video';
