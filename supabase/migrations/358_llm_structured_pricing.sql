-- Migration: seed model_pricing for the generic structured-LLM route
--
--   POST /v1/llm/structured — one forced-schema LLM call, any caller's JSON
--   Schema in, the validated object out. Its own feature id rather than
--   llm-chat's: the callers that need forced output send a RENDERED CATALOG
--   LEGEND as their system prompt (Nodaro Studio's production planner measures
--   ~12-18k tokens), several times a chat turn, so one shared row would
--   misprice one of the two. Three tier rows, the describe-to-picker
--   precedent: buildLlmCreditIdentifier("llm-structured", model, …) yields
--   `llm-structured:economy` / `llm-structured` / `llm-structured:premium`.
--
--   LLM billing is FLAT PER CALL BY TIER, not per token
--   (commitReservedCreditsForJob never passes an actual amount), so all three
--   rows carry one figure. 10 credits = describe-to-picker parity — the other
--   route whose single call carries a large legend prompt.
--   owner-tunable; confirm at PR review.
--
-- STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts is the runtime
-- fallback (also 10); the admin UI reads pricing exclusively from this table.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('llm-structured',         10, true, 'other'),
  ('llm-structured:economy', 10, true, 'other'),
  ('llm-structured:premium', 10, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
