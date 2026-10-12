-- speaker-view: its four price rows (C4, decided 2026-10-10).
--
-- Speaker View renders an edit with its speakers on screen. It is priced PER
-- MINUTE of RENDERED output, in two tiers by how many speakers it composites
-- at once:
--   'speaker-view'                10  a final, 1–2 tiles and no zoom
--   'speaker-view:proxy'           2  a preview, 1–2 tiles and no zoom
--   'speaker-view:complex'        12  a final, 3–6 tiles on some segment, or any zoom
--   'speaker-view:complex:proxy'   3  a preview, 3–6 tiles, or any zoom
-- The cloud plugin's route and the workflow run (speakerViewCreditOverride)
-- both reserve
--   this_per_minute_base × ceil(edlDurationMs(edit as given) / 60000)   (minimum 1 minute)
-- on the row speakerViewCreditId(quality, tier) names (@nodaro/shared); the
-- tier is speakerViewPriceTier (@nodaro/render-rules). The charge is the
-- rendered cut's own minutes at the same rate (never above the reserve).
--
-- Mirrors STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts, whose
-- values are SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE in
-- backend/src/lib/speaker-view-plan.ts (pinned to these rows by
-- credit-pricing-migration-sync.test.ts).
-- ON CONFLICT DO NOTHING keeps an admin retune on re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES
  ('speaker-view', 10),
  ('speaker-view:proxy', 2),
  ('speaker-view:complex', 12),
  ('speaker-view:complex:proxy', 3)
ON CONFLICT (model_identifier) DO NOTHING;
