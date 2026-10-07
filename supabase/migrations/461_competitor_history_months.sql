-- ============================================================
-- Competitors: how many months of scans each plan keeps.
--
-- A tracked brand's scans used to be capped at the newest twelve. They are
-- now kept for a window that follows the subscription plan, read by the
-- cloud plugin at scan time from tier_config.features
-- (competitor_history_months) — so the window changes without a release.
-- payg rides basic's entitlements, as everywhere else (stripe-config.ts).
-- Idempotent: re-applying rewrites the same values.
-- ============================================================
UPDATE tier_config AS t
SET features = COALESCE(t.features, '{}'::jsonb) || jsonb_build_object('competitor_history_months', v.months),
    updated_at = NOW()
FROM (VALUES
  ('free', 1),
  ('payg', 1),
  ('basic', 1),
  ('standard', 3),
  ('pro', 6),
  ('business', 12),
  ('enterprise', 12)
) AS v(tier, months)
WHERE t.tier = v.tier;
