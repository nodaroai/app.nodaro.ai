-- Fix underpriced models from credit audit recheck (2026-03-16)
-- Formula: ceil(kieCredits / 4) at 0% markup

-- elevenlabs-stt: 2→3 (actual avg 8.58 KIE cr, not 3.5; ceil(8.58/4) = 3)
UPDATE model_pricing SET credit_cost = 3 WHERE model_identifier = 'elevenlabs-stt';

-- elevenlabs-isolation: 4→8 (actual 29.6 KIE cr for ~148s audio; ceil(29.6/4) = 8)
UPDATE model_pricing SET credit_cost = 8 WHERE model_identifier = 'elevenlabs-isolation';
