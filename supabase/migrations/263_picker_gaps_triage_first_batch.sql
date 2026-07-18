-- 263_picker_gaps_triage_first_batch.sql
-- Data triage for the first picker-gap report batch (2026-07-18 export, 17
-- rows), resolved by the @nodaro/prompts@1.3.0 catalog additions:
-- outfit-pharaoh, headwear-nemes, outfit-sundress, outfit-soccer-jersey,
-- face-paint-flag, state-halter-neck, state-plunging-neck.
-- Statuses are operational data, but the migration lane is the sanctioned
-- prod-write path (precedent: 139_backfill_stuck_jobs). Idempotent — only
-- touches rows still status='new'; a fresh/self-hosted DB is a no-op.

-- Covered by the new catalog items → 'added'.
UPDATE picker_catalog_gaps SET status = 'added'
WHERE status = 'new' AND picker_type = 'styling' AND (
  (gap_type = 'item' AND dimension = 'headwear' AND observed_norm LIKE '%nemes%')
  OR (gap_type = 'item' AND dimension = 'outfit' AND (
       observed_norm LIKE '%sundress%'
    OR observed_norm LIKE '%maxi dress%'
    OR observed_norm LIKE '%soccer%'
    OR observed_norm LIKE '%pharao%'   -- pharaoh / pharaonic
    OR observed_norm LIKE '%regalia%'
  ))
  OR (gap_type = 'category' AND dimension IN ('neckline', 'sports-fan-gear', 'historical-costume'))
);

-- Deliberate non-adds → 'dismissed':
--  * person 'type' pharaoh + 'historical-persona': identity vs costume — the
--    styling items carry the look; the person picker stays identity-only.
--  * 'subject-type' (stone sculpture/bust): off-domain input, not a catalog gap.
UPDATE picker_catalog_gaps SET status = 'dismissed'
WHERE status = 'new' AND picker_type = 'person' AND (
  dimension IN ('historical-persona', 'subject-type')
  OR (dimension = 'type' AND observed_norm LIKE '%pharao%')
);
