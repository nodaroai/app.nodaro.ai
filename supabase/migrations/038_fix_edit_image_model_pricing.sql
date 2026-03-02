-- Fix edit-image model pricing: recraft-remove-bg was 0 credits (should be 2),
-- nano-banana-edit was 1 credit (should be 2).
***REDACTED-OSS-SCRUB***

UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'recraft-remove-bg';
UPDATE model_pricing SET credit_cost = 2 WHERE model_identifier = 'nano-banana-edit';
