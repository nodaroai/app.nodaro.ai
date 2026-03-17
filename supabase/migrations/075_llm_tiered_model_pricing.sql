-- Add tiered credit pricing for LLM features (economy/premium variants).
-- Base entries (standard tier) already exist — this adds economy and premium composites.
-- Economy = ~0.5x base (min 1 credit), Premium = 3x base.

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  -- prompt-helper: base=1
  ('prompt-helper',          1, true, 'other'),
  ('prompt-helper:economy',  1, true, 'other'),
  ('prompt-helper:premium',  3, true, 'other'),

  -- ai-writer: base=5
  ('ai-writer:economy',      3, true, 'other'),
  ('ai-writer:premium',     15, true, 'other'),

  -- scene-graph-ai: base=10
  ('scene-graph-ai:economy',  5, true, 'other'),
  ('scene-graph-ai:premium', 30, true, 'other'),

  -- video-composer: base=10
  ('video-composer:economy',  5, true, 'other'),
  ('video-composer:premium', 30, true, 'other'),

  -- after-effects: base=10
  ('after-effects:economy',   5, true, 'other'),
  ('after-effects:premium',  30, true, 'other'),

  -- lottie-overlay: base=10
  ('lottie-overlay:economy',  5, true, 'other'),
  ('lottie-overlay:premium', 30, true, 'other'),

  -- 3d-title: base=15
  ('3d-title:economy',        8, true, 'other'),
  ('3d-title:premium',       45, true, 'other'),

  -- motion-graphics: base=10
  ('motion-graphics:economy',  5, true, 'other'),
  ('motion-graphics:premium', 30, true, 'other'),

  -- generate-script: base=10
  ('generate-script:economy',  5, true, 'other'),
  ('generate-script:premium', 30, true, 'other'),

  -- qa-check: base=5
  ('qa-check:economy',        3, true, 'other'),
  ('qa-check:premium',       15, true, 'other'),

  -- image-to-text: base=5
  ('image-to-text:economy',   3, true, 'other'),
  ('image-to-text:premium',  15, true, 'other')

ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
