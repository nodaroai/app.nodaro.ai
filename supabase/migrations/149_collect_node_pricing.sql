-- 149_collect_node_pricing.sql
-- Seed model_pricing rows for the Collect (fan-in) node's 6 strategy
-- composite identifiers.
--
-- Format: collect:<strategyId> — built by buildCreditModelIdentifier() in
-- backend/src/ee/billing/credits.ts (the dispatcher reads `data.strategyId`).
-- STATIC_CREDIT_COSTS in credits.ts is the runtime fallback; the admin UI
-- (/admin/models) reads pricing exclusively from this table, so without
-- these rows the strategies are invisible / not overrideable from the admin.
--
-- Per CLAUDE.md "Provider Enum Sync" step 9, every key in
-- STATIC_CREDIT_COSTS needs a matching INSERT here.
--
-- Pricing:
--   pick-best-llm = 3 (one Sonnet pass to choose among inputs)
--   all others    = 0 (pure orchestration — concat / first-non-empty /
--                      count / vote / merge-json have no API cost)

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('collect:pick-best-llm',   3, true, 'other'),
  ('collect:concat',          0, true, 'other'),
  ('collect:first-non-empty', 0, true, 'other'),
  ('collect:count',           0, true, 'other'),
  ('collect:vote',            0, true, 'other'),
  ('collect:merge-json',      0, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
