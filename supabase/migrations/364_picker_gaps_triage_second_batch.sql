-- 364_picker_gaps_triage_second_batch.sql
-- Data triage for the second picker-gap report batch (2026-09-01 export, 12
-- rows), resolved by the PR #1109 catalog additions (styling
-- outfit-workwear-overalls / outfit-chapan / outfit-caftan + headwear
-- multi-select; person samarkand-silk-road / tashkent-modern) and classified
-- by the PR #1110 gap classifier.
-- Statuses are operational data, but the migration lane is the sanctioned
-- prod-write path (precedent: 263_picker_gaps_triage_first_batch). Idempotent —
-- only touches rows still status='new'; a fresh/self-hosted DB is a no-op.

-- Covered by the PR #1109 styling catalog additions → 'added':
--  * outfit-workwear-overalls (denim bib overalls + plaid flannel) — the farmer
--    work outfit (n3).
--  * headwear multi-select (up to 2) — headwear-sun-hat / straw hat layers over
--    the existing headwear-turban, expressing the sun-hat-over-turban and
--    straw-hat-over-wrapped-turban combos (n4, n6, n7).
--  * outfit-chapan (Central Asian quilted ikat robe) / outfit-caftan — the
--    traditional long robe / qaba / chapan / joma (n10, n12).
UPDATE picker_catalog_gaps SET status = 'added'
WHERE status = 'new' AND picker_type = 'styling' AND (
     (gap_type = 'item' AND dimension = 'outfit' AND observed_norm LIKE '%denim overalls with plaid shirt%')
  OR (gap_type = 'item' AND dimension = 'headwear' AND observed_norm LIKE '%turban/head wrap combination%')
  OR (gap_type = 'item' AND dimension = 'headwear' AND observed_norm LIKE '%dark turban wrap%')
  OR (gap_type = 'category' AND dimension = 'layered-headwear')
  OR (gap_type = 'category' AND dimension = 'traditional-robe' AND observed_norm LIKE '%qaba%')
  OR (gap_type = 'category' AND dimension = 'traditional-robe' AND observed_norm LIKE '%chapan/joma%')
);

-- Deliberate non-adds → 'dismissed' (the fix landed in another picker):
--  * handwear/gloves + handheld-accessory: gloves are HELD, not worn — PR #1109
--    routed work-gloves to the held-prop picker (category occupational); styling
--    gained no glove lever (n2, n5).
--  * historical-period: the Prokudin-Gorsky / early-20th-century attribute is
--    style/era — PR #1109 added early-color-photo to style and era already has
--    edwardian; styling gained no period lever (n8).
UPDATE picker_catalog_gaps SET status = 'dismissed'
WHERE status = 'new' AND picker_type = 'styling' AND (
  gap_type = 'category'
  AND dimension IN ('handwear/gloves', 'handheld-accessory', 'historical-period')
);

-- Covered by the PR #1109 person catalog additions → 'added':
--  * samarkand-silk-road + tashkent-modern (new Central Asia group, dimension
--    regional-aesthetic) — the Uzbek/Samarkand bazaar-vendor aesthetic
--    previously mis-picked as marrakech-bohemian (n11).
UPDATE picker_catalog_gaps SET status = 'added'
WHERE status = 'new' AND picker_type = 'person' AND (
  gap_type = 'item'
  AND dimension = 'regional-aesthetic'
  AND observed_norm LIKE '%central asian bazaar vendor%'
);

-- Deliberate non-adds → 'dismissed' (mis-attributed to person):
--  * character-style: the 3D-animated-cartoon (PJ Masks) render-medium is a
--    STYLE attribute (style has pixar-3d / 3d-render); person handles real
--    humans and gained no such ability (n1).
--  * occupation-context: the melon-stall-under-a-canopy scene is a SETTING
--    attribute (setting gained open-air-market); the fix routed this row's
--    attributes to setting/styling/held-prop, none to person (n9).
UPDATE picker_catalog_gaps SET status = 'dismissed'
WHERE status = 'new' AND picker_type = 'person' AND (
  gap_type = 'category'
  AND dimension IN ('character-style', 'occupation-context')
);
