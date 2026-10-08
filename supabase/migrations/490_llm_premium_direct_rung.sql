-- Migration: the premium-direct credit rung for every tier-priced LLM feature
--
--   Decided 2026-10-08: an LLM call is priced on the lane it runs on. A call
--   runs on the vendor's own API when Advanced mode is on, or when it carries a
--   reasoning effort on a model whose effort only works there (the Claude
--   family). Such a call bills one rung up — and a premium model, which had no
--   rung above it, now bills on `<feature>:premium-direct`
--   (buildLlmCreditIdentifier in @nodaro/shared).
--
--   Each premium-direct price is CEIL(the feature's premium price × 2.5) —
--   LLM_PREMIUM_DIRECT_MULTIPLIER in backend/src/ee/billing/credits.ts, whose
--   STATIC_CREDIT_COSTS fallback derives the same rows. Two steps:
--     1. a literal insert at the STATIC-derived value (the shape the admin UI
--        and the pricing-sync guard read), ON CONFLICT DO NOTHING;
--     2. re-derive each row this migration created from the LIVE premium row,
--        so a premium price an admin tuned in the database carries over
--        instead of the static one. The ids are new, so every row step 2
--        touches is one step 1 just created — no admin price exists to clobber.
--   The Workflow Copilot and the social-scraper analysis tiers are excluded:
--   their tier ids are not built by the LLM credit builder (see
--   LLM_DIRECT_RUNG_FEATURES / NO_DIRECT_RUNG in credits.ts).

BEGIN;

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('prompt-helper:premium-direct', 18, true, 'other'),
  ('ai-writer:premium-direct', 5, true, 'other'),
  ('llm-chat:premium-direct', 15, true, 'other'),
  ('translate:premium-direct', 25, true, 'other'),
  ('scene-graph-ai:premium-direct', 100, true, 'other'),
  ('video-composer:premium-direct', 100, true, 'other'),
  ('after-effects:premium-direct', 50, true, 'other'),
  ('lottie-overlay:premium-direct', 50, true, 'other'),
  ('3d-title:premium-direct', 100, true, 'other'),
  ('motion-graphics:premium-direct', 75, true, 'other'),
  ('motion-graphics-lottie:premium-direct', 200, true, 'other'),
  ('3d-scene:premium-direct', 100, true, 'other'),
  ('reduce:pick-best-llm:premium-direct', 63, true, 'other'),
  ('generate-script:premium-direct', 75, true, 'other'),
  ('qa-check:premium-direct', 100, true, 'other'),
  ('image-to-text:premium-direct', 10, true, 'other'),
  ('describe-to-picker:premium-direct', 25, true, 'other'),
  ('llm-structured:premium-direct', 25, true, 'other'),
  ('image-critic:premium-direct', 100, true, 'other'),
  ('content-recipe:premium-direct', 88, true, 'other'),
  ('content-ideas:premium-direct', 125, true, 'other'),
  ('content-ideas:10:premium-direct', 250, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;

UPDATE public.model_pricing AS direct
SET credit_cost = CEIL(premium.credit_cost * 2.5)::int
FROM public.model_pricing AS premium
WHERE premium.model_identifier = left(direct.model_identifier, length(direct.model_identifier) - length('-direct'))
  AND direct.credit_cost IS DISTINCT FROM CEIL(premium.credit_cost * 2.5)::int
  AND direct.model_identifier IN (
    'prompt-helper:premium-direct',
    'ai-writer:premium-direct',
    'llm-chat:premium-direct',
    'translate:premium-direct',
    'scene-graph-ai:premium-direct',
    'video-composer:premium-direct',
    'after-effects:premium-direct',
    'lottie-overlay:premium-direct',
    '3d-title:premium-direct',
    'motion-graphics:premium-direct',
    'motion-graphics-lottie:premium-direct',
    '3d-scene:premium-direct',
    'reduce:pick-best-llm:premium-direct',
    'generate-script:premium-direct',
    'qa-check:premium-direct',
    'image-to-text:premium-direct',
    'describe-to-picker:premium-direct',
    'llm-structured:premium-direct',
    'image-critic:premium-direct',
    'content-recipe:premium-direct',
    'content-ideas:premium-direct',
    'content-ideas:10:premium-direct'
  );

COMMIT;
