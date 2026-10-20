-- 547: Speaker Layout's per-run fee, 10 credits like every podcast use-case
-- node's (migrations 509, 531). The node ships hidden; a row for a node not
-- yet listed charges nothing.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('use-case-fee:speaker-layout', 10, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
