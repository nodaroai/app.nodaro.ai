-- Nodaro Motion's per-second fee rates (decided 2026-11-03: tunable in
-- /admin/models). The cast-swap plugin reads both through
-- `tk.http.unitRatePrice` (the `model_pricing` row, else STATIC_CREDIT_COSTS)
-- and its floors for them are these same values:
--   cast-swap:per-second               2 base credits a second
--   cast-swap-full-quality:per-second  4 base credits a second
-- Values MUST match STATIC_CREDIT_COSTS (credit-pricing-migration-sync.test.ts,
-- static-costs-match-migrations.test.ts), proven on a database by
-- supabase/tests/cast-swap-per-second-rates.behavior.sql.
--
-- ON CONFLICT DO NOTHING keeps any admin retune, and makes a second run a
-- no-op.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('cast-swap:per-second', 2, true, 'video'),
  ('cast-swap-full-quality:per-second', 4, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
