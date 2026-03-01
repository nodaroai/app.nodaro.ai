-- Add ElevenLabs Sound Effect V2 model to model_pricing table
-- elevenlabs-sfx: Sound effects generation via ElevenLabs SFX v2 - 1 credit

-- Skip if model_pricing table doesn't exist yet (created in 017_billing_schema.sql).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'model_pricing') THEN
    RAISE NOTICE 'model_pricing table does not exist yet, skipping (will be created in 017)';
    RETURN;
  END IF;

  INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category)
  VALUES
    ('elevenlabs-sfx', 1, true, 'audio')
  ON CONFLICT (model_identifier) DO UPDATE
    SET credit_cost = EXCLUDED.credit_cost,
        is_enabled = EXCLUDED.is_enabled,
        category = EXCLUDED.category;
END $$;
