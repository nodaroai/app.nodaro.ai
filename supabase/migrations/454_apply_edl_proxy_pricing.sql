-- apply-edl preview renders: their own credit row.
--
-- An Apply EDL render at quality "proxy" (the 720p preview, a video or an
-- audio output) is priced on 'apply-edl:proxy'; a final render keeps
-- 'apply-edl' (migration 431). Both are PER MINUTE of RENDERED output: the
-- route's creditGuard.computeCredits and the DAG's applyEdlCreditOverride both
-- reserve
--   this_per_minute_base × ceil(edlDurationMs / 60000)   (minimum 1 minute)
-- on the row applyEdlCreditId(quality) names (@nodaro/shared).
--
-- Mirrors STATIC_CREDIT_COSTS['apply-edl:proxy'] in
-- backend/src/ee/billing/credits.ts, whose value is the single source of truth
-- APPLY_EDL_PROXY_CREDITS_PER_OUTPUT_MINUTE in backend/src/lib/apply-edl-plan.ts
-- (pinned to this row by credit-pricing-migration-sync.test.ts).
--
-- The preview rate, decided 2026-10-04 (the final stays at 10). This row and
-- that constant are retuned together, keeping the preview below the final.
-- ON CONFLICT DO NOTHING keeps an admin retune on re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('apply-edl:proxy', 2)
ON CONFLICT (model_identifier) DO NOTHING;
