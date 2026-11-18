-- ============================================================
-- Competitors: a brand can hold up to 100 search terms.
--
-- Migration 664 capped `search_terms` at 15 per brand. A plan still allows
-- far fewer (tier_config.features.competitor_search_terms: Standard 3, Pro 5,
-- Business 10), and that cap is unchanged. What changes is the ceiling a
-- platform admin is held to: no longer a count of terms but the size of one
-- scan, which the cloud plugin limits to 100 searches (each account, and each
-- platform once per term). One platform then fits up to a hundred terms; all
-- six about fifteen. The column's ceiling is the most a single platform can
-- use.
--
-- The 664 constraint was declared inline, so its name is Postgres's own: it is
-- found by what it checks and dropped, then the new one is added by name.
-- Idempotent.
-- ============================================================

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.tracked_competitors'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%cardinality(search_terms)%'
  LOOP
    EXECUTE format('ALTER TABLE public.tracked_competitors DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.tracked_competitors
  ADD CONSTRAINT tracked_competitors_search_terms_check CHECK (cardinality(search_terms) <= 100);
