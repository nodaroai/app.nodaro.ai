-- 208_community_creature_entity_type.sql — widen community_listings.entity_type CHECK to allow 'creature'.
-- (Spec §9 specified 207; bumped to 208 because 207_append_character_reference_video.sql claimed 207
--  after the spec was written. Supabase keys migrations by numeric prefix and silently skips a reused
--  number, so two 207s would drop one on prod.)
-- The 201 CHECK is an unnamed inline column constraint → Postgres auto-name community_listings_entity_type_check.
-- Idempotent. Does NOT touch community_listings_likeness_chk (201:44).
ALTER TABLE community_listings DROP CONSTRAINT IF EXISTS community_listings_entity_type_check;
ALTER TABLE community_listings ADD CONSTRAINT community_listings_entity_type_check
  CHECK (entity_type IN ('character','location','object','creature'));
