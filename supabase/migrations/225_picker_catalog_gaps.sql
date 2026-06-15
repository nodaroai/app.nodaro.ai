-- 225_picker_catalog_gaps.sql
-- Catalog-gap feedback from the describe-to-picker analyzer: when the vision
-- LLM had to settle for a close-but-imperfect catalog match (missing item) or
-- found a salient attribute no dimension covers (missing category). Aggregated
-- by (picker, gap_type, dimension, normalized observed) with an occurrence
-- count. Admin-only read (Phase 2 dashboard); service-role write via RPC.

CREATE TABLE IF NOT EXISTS picker_catalog_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  picker_type TEXT NOT NULL,
  gap_type TEXT NOT NULL CHECK (gap_type IN ('item', 'category')),
  dimension TEXT NOT NULL,
  observed TEXT NOT NULL,
  observed_norm TEXT NOT NULL,
  chosen_id TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'added', 'dismissed')),
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  sample_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (picker_type, gap_type, dimension, observed_norm)
);

CREATE INDEX IF NOT EXISTS idx_picker_catalog_gaps_status ON picker_catalog_gaps (status) WHERE status = 'new';
CREATE INDEX IF NOT EXISTS idx_picker_catalog_gaps_picker ON picker_catalog_gaps (picker_type);
CREATE INDEX IF NOT EXISTS idx_picker_catalog_gaps_count ON picker_catalog_gaps (count DESC);

ALTER TABLE picker_catalog_gaps ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'picker_catalog_gaps' AND policyname = 'service_role_all') THEN
    CREATE POLICY "service_role_all" ON picker_catalog_gaps FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'picker_catalog_gaps' AND policyname = 'admin_read') THEN
    CREATE POLICY "admin_read" ON picker_catalog_gaps FOR SELECT TO authenticated USING (is_admin());
  END IF;
END $$;

-- Atomic upsert-increment (mirrors 088_upsert_execution_stats_rpc): concurrent
-- analyses of the same gap must not lose counts. chosen_id back-fills if a later
-- occurrence has one and the existing row doesn't.
CREATE OR REPLACE FUNCTION record_picker_catalog_gap(
  p_picker_type TEXT,
  p_gap_type TEXT,
  p_dimension TEXT,
  p_observed TEXT,
  p_observed_norm TEXT,
  p_chosen_id TEXT,
  p_sample_user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO picker_catalog_gaps (
    picker_type, gap_type, dimension, observed, observed_norm, chosen_id, sample_user_id
  ) VALUES (
    p_picker_type, p_gap_type, p_dimension, p_observed, p_observed_norm, p_chosen_id, p_sample_user_id
  )
  ON CONFLICT (picker_type, gap_type, dimension, observed_norm)
  DO UPDATE SET
    count = picker_catalog_gaps.count + 1,
    last_seen = now(),
    chosen_id = COALESCE(picker_catalog_gaps.chosen_id, EXCLUDED.chosen_id);
END;
$$;

REVOKE ALL ON FUNCTION record_picker_catalog_gap(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_picker_catalog_gap(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO service_role;
