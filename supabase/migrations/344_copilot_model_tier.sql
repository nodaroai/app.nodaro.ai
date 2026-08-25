-- Copilot model ladder (Phase 9 of the knowledge-loop track): the v1 plan's
-- dormant three-tier design, activated. The tier lives on the THREAD (the
-- cached prompt prefix is per model — per-message flips would pay a full
-- prefix rewrite each time), read column-tolerantly in code until this
-- reaches the shared database.

ALTER TABLE public.copilot_threads
  ADD COLUMN IF NOT EXISTS model_tier text NOT NULL DEFAULT 'standard'
  CHECK (model_tier IN ('economy', 'standard', 'premium'));

-- Reservation ceilings for the two non-default rungs. The turn still commits
-- METERED actuals (real model cost per iteration); these only scale how much
-- is reserved up front. Values are conservative first guesses relative to the
-- base 'workflow-copilot' row — tune with the audit-credits flow after real
-- usage, like every other reservation ceiling.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('workflow-copilot:economy', 300, true, 'other'),
  ('workflow-copilot:premium', 2700, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
