-- 2026-05-28 — LTX 2.3 model_pricing — replace placeholders with official Replicate rates.
--
-- Source: https://replicate.com/lightricks/ltx-2.3-{pro,fast} (rendered pricing).
-- Pro:  $0.08 / $0.16 / $0.32 per second of output video for 1080p / 2k / 4k.
-- Fast: $0.06 / $0.12 / $0.24 per second of output video for 1080p / 2k / 4k.
***REDACTED-OSS-SCRUB***
-- Extend + retake are Pro-only at 1080p → 5 credits/sec.
--
-- Replaces (not seeded twice): migration 159_ltx_2_3_models.sql inserted placeholders
-- 6–10× higher. This UPDATE corrects every existing row in-place.

UPDATE model_pricing SET credit_cost = 30  WHERE model_identifier = 'ltx-2.3-pro';
UPDATE model_pricing SET credit_cost = 30  WHERE model_identifier = 'ltx-2.3-pro:1080p:6s';
UPDATE model_pricing SET credit_cost = 40  WHERE model_identifier = 'ltx-2.3-pro:1080p:8s';
UPDATE model_pricing SET credit_cost = 50  WHERE model_identifier = 'ltx-2.3-pro:1080p:10s';
UPDATE model_pricing SET credit_cost = 60  WHERE model_identifier = 'ltx-2.3-pro:2k:6s';
UPDATE model_pricing SET credit_cost = 80  WHERE model_identifier = 'ltx-2.3-pro:2k:8s';
UPDATE model_pricing SET credit_cost = 100 WHERE model_identifier = 'ltx-2.3-pro:2k:10s';
UPDATE model_pricing SET credit_cost = 120 WHERE model_identifier = 'ltx-2.3-pro:4k:6s';
UPDATE model_pricing SET credit_cost = 160 WHERE model_identifier = 'ltx-2.3-pro:4k:8s';
UPDATE model_pricing SET credit_cost = 200 WHERE model_identifier = 'ltx-2.3-pro:4k:10s';

UPDATE model_pricing SET credit_cost = 23 WHERE model_identifier = 'ltx-2.3-fast';
UPDATE model_pricing SET credit_cost = 23 WHERE model_identifier = 'ltx-2.3-fast:1080p:6s';
UPDATE model_pricing SET credit_cost = 30 WHERE model_identifier = 'ltx-2.3-fast:1080p:8s';
UPDATE model_pricing SET credit_cost = 38 WHERE model_identifier = 'ltx-2.3-fast:1080p:10s';
UPDATE model_pricing SET credit_cost = 45 WHERE model_identifier = 'ltx-2.3-fast:1080p:12s';
UPDATE model_pricing SET credit_cost = 53 WHERE model_identifier = 'ltx-2.3-fast:1080p:14s';
UPDATE model_pricing SET credit_cost = 60 WHERE model_identifier = 'ltx-2.3-fast:1080p:16s';
UPDATE model_pricing SET credit_cost = 68 WHERE model_identifier = 'ltx-2.3-fast:1080p:18s';
UPDATE model_pricing SET credit_cost = 75 WHERE model_identifier = 'ltx-2.3-fast:1080p:20s';
UPDATE model_pricing SET credit_cost = 45 WHERE model_identifier = 'ltx-2.3-fast:2k:6s';
UPDATE model_pricing SET credit_cost = 60 WHERE model_identifier = 'ltx-2.3-fast:2k:8s';
UPDATE model_pricing SET credit_cost = 75 WHERE model_identifier = 'ltx-2.3-fast:2k:10s';
UPDATE model_pricing SET credit_cost = 90  WHERE model_identifier = 'ltx-2.3-fast:4k:6s';
UPDATE model_pricing SET credit_cost = 120 WHERE model_identifier = 'ltx-2.3-fast:4k:8s';
UPDATE model_pricing SET credit_cost = 150 WHERE model_identifier = 'ltx-2.3-fast:4k:10s';

UPDATE model_pricing SET credit_cost = 5 WHERE model_identifier = 'ltx-2.3-pro-extend:per-second';
UPDATE model_pricing SET credit_cost = 5 WHERE model_identifier = 'ltx-2.3-pro-retake:per-second';
