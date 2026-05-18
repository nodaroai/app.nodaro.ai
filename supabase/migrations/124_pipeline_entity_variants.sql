-- Migration 124 — Phase 1B.1: entity variant metadata
-- Architecture spec §4 (Stages 2 + 4) need to track variant generation per entity.

-- Per-entity tally so the engine knows how many variants are expected before batch approval.
ALTER TABLE pipeline_entities
  ADD COLUMN IF NOT EXISTS variant_count integer NOT NULL DEFAULT 0
    CHECK (variant_count >= 0 AND variant_count <= 8);

-- Per-variant kind discriminator. Characters use ('angle' | 'expression');
-- Locations use ('time_of_day' | 'weather' | 'aftermath' | 'angle');
-- Objects have 0 variants in Phase 1B.1 (the column is enum-validated but rows are absent).
ALTER TABLE pipeline_entity_variants
  ADD COLUMN IF NOT EXISTS variant_kind text
    CHECK (variant_kind IN ('angle', 'expression', 'time_of_day', 'weather', 'aftermath'));

-- Future: a partial index if list-by-kind queries become hot. Skip for Phase 1B.1.
