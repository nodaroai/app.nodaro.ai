-- 673: the podcast pack's rate — one price per started 15 seconds of the
-- original recording, every tool chosen in the pack included (its steps hold
-- nothing). A base of 20 a unit; a pack is charged its units' base marked up
-- once, as every per-unit rate is.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('podcast-pack:per-15s', 20, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
