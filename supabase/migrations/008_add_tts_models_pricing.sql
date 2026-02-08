-- Add TTS model entries to model_pricing table
-- elevenlabs-turbo: Turbo v2.5 (fast, English-optimized) - 1 credit
-- elevenlabs-multilingual: Multilingual v2 (all languages) - 1 credit

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('elevenlabs-turbo', 1, true, 'audio'),
  ('elevenlabs-multilingual', 1, true, 'audio')
ON CONFLICT (model_identifier) DO UPDATE
  SET credit_cost = EXCLUDED.credit_cost,
      is_enabled = EXCLUDED.is_enabled,
      category = EXCLUDED.category;
