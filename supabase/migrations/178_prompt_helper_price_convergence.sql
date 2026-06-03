-- prompt-helper: converge model_pricing to STATIC_CREDIT_COSTS (2).
--
-- The bare standard-tier `prompt-helper` identifier was seeded at 1 credit in
-- migration 075 and never re-baselined, while STATIC_CREDIT_COSTS["prompt-helper"]
-- is 2 (and the rebaseline batch in migration 175 updated prompt-helper:premium
-- to 3 but skipped the bare key). getModelCreditBaseCost reads model_pricing
-- first, so standard-tier prompt-helper calls (incl. the now-metered
-- /v1/llm-suggest-description ✨ helper) under-charge by ~1 credit. Converge the
-- DB value to the static/intended rate. Idempotent.

UPDATE public.model_pricing
   SET credit_cost = 2
 WHERE model_identifier = 'prompt-helper'
   AND credit_cost <> 2;
