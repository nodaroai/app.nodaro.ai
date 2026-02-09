-- Suno model pricing seed
-- Run in Supabase SQL Editor (idempotent via ON CONFLICT)

INSERT INTO model_pricing (model_identifier, display_name, credit_cost, our_cost, markup, is_enabled, provider, category)
VALUES
  ('suno-generate',       'Suno Generate',            3,  0.06,  0.25, true, 'KIE.ai', 'music'),
  ('suno-cover',          'Suno Cover',               3,  0.06,  0.25, true, 'KIE.ai', 'music'),
  ('suno-extend',         'Suno Extend',              3,  0.06,  0.25, true, 'KIE.ai', 'music'),
  ('suno-lyrics',         'Suno Lyrics',              1,  0.002, 0.25, true, 'KIE.ai', 'music'),
  ('suno-separate-vocal', 'Suno Vocal Separation',    2,  0.05,  0.25, true, 'KIE.ai', 'music'),
  ('suno-separate-stem',  'Suno Multi-Stem Split',    4,  0.25,  0.25, true, 'KIE.ai', 'music'),
  ('suno-music-video',    'Suno Music Video',         1,  0.01,  0.25, true, 'KIE.ai', 'music')
ON CONFLICT (model_identifier) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  credit_cost  = EXCLUDED.credit_cost,
  our_cost     = EXCLUDED.our_cost,
  markup       = EXCLUDED.markup,
  is_enabled   = EXCLUDED.is_enabled,
  provider     = EXCLUDED.provider,
  category     = EXCLUDED.category;
