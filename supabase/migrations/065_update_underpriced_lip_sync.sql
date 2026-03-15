-- Update underpriced lip-sync models (per-second KIE billing at ~14s avg duration)
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
-- infinitalk:       was 19 (assumed 5s), actual 42–168 KIE cr ($0.21–$0.84) → 26 credits

UPDATE model_pricing SET credit_cost = 28 WHERE model_identifier = 'kling-avatar';
UPDATE model_pricing SET credit_cost = 56 WHERE model_identifier = 'kling-avatar-pro';
UPDATE model_pricing SET credit_cost = 26 WHERE model_identifier = 'infinitalk';
