-- Update underpriced models: nano-banana-2 and gpt-image
-- nano-banana-2: fair price 4.05, was 3
-- gpt-image: fair price 3.25, was 2

UPDATE model_pricing SET credit_cost = 4 WHERE model_identifier = 'nano-banana-2';
UPDATE model_pricing SET credit_cost = 5 WHERE model_identifier = 'nano-banana-2:2K';
UPDATE model_pricing SET credit_cost = 7 WHERE model_identifier = 'nano-banana-2:4K';
UPDATE model_pricing SET credit_cost = 4 WHERE model_identifier = 'gpt-image';
UPDATE model_pricing SET credit_cost = 4 WHERE model_identifier = 'gpt-image-i2i';
