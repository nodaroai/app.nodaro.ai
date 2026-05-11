-- Wan 2.7 VideoEdit model pricing
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('wan-videoedit', 32, true, 'video-to-video')
ON CONFLICT (model_identifier) DO NOTHING;
