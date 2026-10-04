-- Trim Video, Loop Video, Combine Videos and Assemble Narrated Video are
-- priced per unit of what they make: 10 credits per 5 seconds of output (and
-- per ~24 frames a smart loop cut searches, per combine input beyond two, per
-- Assemble step). The owner confirmed the per-unit price on 2026-10-04: the
-- single-node routes had stayed at the pre-redenomination unit (a tenth of the
-- listed price), and workflow runs reserved a flat row whatever the length.
--
-- Each node's own row is now exactly ONE unit, so an estimate can quote the row
-- times the units. Trim and Loop already were; Combine (30) and Assemble (40)
-- move to 10. Conditional UPDATEs: an administrator's own override stays.
-- Mirrors STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
UPDATE model_pricing SET credit_cost = 10 WHERE model_identifier = 'combine-videos' AND credit_cost = 30;
UPDATE model_pricing SET credit_cost = 10 WHERE model_identifier = 'assemble-narrated-video' AND credit_cost = 40;
