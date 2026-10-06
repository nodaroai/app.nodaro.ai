-- The text-to-dialogue node-type fallback equals the default dialogue model's
-- flat row (25); it was 40 since migration 288. Only a row still at 40 moves —
-- an administrator's retune survives. Reached only when a dialogue model's own
-- row is unpriced, and as the editor's cold-cache figure (decided 2026-10-06).
UPDATE public.model_pricing SET credit_cost = 25 WHERE model_identifier = 'text-to-dialogue' AND credit_cost = 40;
