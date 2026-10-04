-- Price corrections the owner confirmed on 2026-10-04, from the docs site's
-- findings (it prints every price from the app's synced data).
--
-- QA Check and Image Critic: one ladder that rises with the model —
-- economy 10, standard 20, premium 40. QA Check's economy row stayed at 1
-- through the x10 credit re-denomination and its premium equalled standard;
-- Image Critic's economy tier sat above its standard (default) tier.
--
-- VEO 3.1 Quality at 4K is a 1080p generation plus the 4K upscale, so it
-- costs more than the flat 1080p price (1000): 1300, not 930.
--
-- Conditional UPDATEs: only a row still at the value being corrected moves, so
-- an administrator's own override stays. Mirrors STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts (pinned by credit-tier-ladder.test.ts).
UPDATE model_pricing SET credit_cost = 10 WHERE model_identifier = 'qa-check:economy' AND credit_cost = 1;
UPDATE model_pricing SET credit_cost = 20 WHERE model_identifier = 'qa-check' AND credit_cost = 10;
UPDATE model_pricing SET credit_cost = 40 WHERE model_identifier = 'qa-check:premium' AND credit_cost = 10;
UPDATE model_pricing SET credit_cost = 20 WHERE model_identifier = 'image-critic' AND credit_cost = 5;
UPDATE model_pricing SET credit_cost = 40 WHERE model_identifier = 'image-critic:premium' AND credit_cost = 20;
UPDATE model_pricing SET credit_cost = 1300 WHERE model_identifier = 'veo3:4k' AND credit_cost = 930;
