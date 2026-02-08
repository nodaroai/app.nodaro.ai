-- Add ElevenLabs Sound Effect V2 model to model_pricing table
-- elevenlabs-sfx: Sound effects generation via ElevenLabs SFX v2 - 1 credit

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('elevenlabs-sfx', 1, true, 'audio')
ON CONFLICT (model_identifier) DO UPDATE
  SET credit_cost = EXCLUDED.credit_cost,
      is_enabled = EXCLUDED.is_enabled,
      category = EXCLUDED.category;
