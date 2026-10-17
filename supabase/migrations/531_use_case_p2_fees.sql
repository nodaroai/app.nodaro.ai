-- 531: the per-run fee of three more podcast use-case nodes, 10 credits each
-- like Tighten Episode's (migration 509): Chapters, Trailer and Clip Pack. The
-- nodes ship hidden; a row for a node not yet listed charges nothing.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('use-case-fee:episode-chapters', 10, true, 'other'),
  ('use-case-fee:episode-trailer', 10, true, 'other'),
  ('use-case-fee:clip-pack', 10, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
