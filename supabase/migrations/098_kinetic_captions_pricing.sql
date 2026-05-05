-- 098_kinetic_captions_pricing.sql
-- Align base add-captions cost with STATIC_CREDIT_COSTS (3 credits) and seed
-- the new composite identifier for kinetic styles (5 credits).

UPDATE public.model_pricing
   SET credit_cost = 3
 WHERE model_identifier = 'add-captions'
   AND credit_cost = 0;  -- only correct the broken seed; preserve admin overrides

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('add-captions:kinetic', 5, true, 'processing')
ON CONFLICT (model_identifier) DO NOTHING;
