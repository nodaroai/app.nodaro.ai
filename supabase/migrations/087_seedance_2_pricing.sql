-- Seedance 2.0 / 2.0 Fast pricing
-- Per-second billing dimensioned by duration (4s/8s/12s/15s tiers) × resolution (480p/720p) × video-ref (none/-ref).
-- Identifier format: seedance-2[-fast]:{tier}:{resolution}[-ref]
-- Source rates (KIE.ai): seedance-2 480p=19/11.5, 720p=41/25 cr/s; seedance-2-fast 480p=15.5/8, 720p=33/20 cr/s (no-ref/ref).
-- Nodaro credits = ceil(kie_credits / 4) at 0% markup.

-- Seedance 2.0 Standard — base fallback (8s, 480p, no ref)
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled) VALUES
  ('seedance-2', 38, true),
  ('seedance-2:4s:480p', 19, true),
  ('seedance-2:8s:480p', 38, true),
  ('seedance-2:12s:480p', 57, true),
  ('seedance-2:15s:480p', 72, true),
  ('seedance-2:4s:480p-ref', 12, true),
  ('seedance-2:8s:480p-ref', 23, true),
  ('seedance-2:12s:480p-ref', 35, true),
  ('seedance-2:15s:480p-ref', 44, true),
  ('seedance-2:4s:720p', 41, true),
  ('seedance-2:8s:720p', 82, true),
  ('seedance-2:12s:720p', 123, true),
  ('seedance-2:15s:720p', 154, true),
  ('seedance-2:4s:720p-ref', 25, true),
  ('seedance-2:8s:720p-ref', 50, true),
  ('seedance-2:12s:720p-ref', 75, true),
  ('seedance-2:15s:720p-ref', 94, true)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- Seedance 2.0 Fast — base fallback (8s, 480p, no ref)
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled) VALUES
  ('seedance-2-fast', 31, true),
  ('seedance-2-fast:4s:480p', 16, true),
  ('seedance-2-fast:8s:480p', 31, true),
  ('seedance-2-fast:12s:480p', 47, true),
  ('seedance-2-fast:15s:480p', 59, true),
  ('seedance-2-fast:4s:480p-ref', 8, true),
  ('seedance-2-fast:8s:480p-ref', 16, true),
  ('seedance-2-fast:12s:480p-ref', 24, true),
  ('seedance-2-fast:15s:480p-ref', 30, true),
  ('seedance-2-fast:4s:720p', 33, true),
  ('seedance-2-fast:8s:720p', 66, true),
  ('seedance-2-fast:12s:720p', 99, true),
  ('seedance-2-fast:15s:720p', 124, true),
  ('seedance-2-fast:4s:720p-ref', 20, true),
  ('seedance-2-fast:8s:720p-ref', 40, true),
  ('seedance-2-fast:12s:720p-ref', 60, true),
  ('seedance-2-fast:15s:720p-ref', 75, true)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
