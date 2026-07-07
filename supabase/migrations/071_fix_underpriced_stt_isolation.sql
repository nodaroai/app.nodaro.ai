-- Fix underpriced models from credit audit recheck (2026-03-16)
-- Re-priced against a provider billing audit (0% markup)

-- elevenlabs-stt: 2→3 (re-priced to match actual measured usage vs. the original estimate)
UPDATE model_pricing SET credit_cost = 3 WHERE model_identifier = 'elevenlabs-stt';

-- elevenlabs-isolation: 4→8 (re-priced for ~148s audio to match actual measured usage)
UPDATE model_pricing SET credit_cost = 8 WHERE model_identifier = 'elevenlabs-isolation';
