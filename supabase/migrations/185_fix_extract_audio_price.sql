-- Migration: correct extract-audio's credit price on already-migrated envs.
--
-- extract-audio was applied at 0 credits by migration 059 (a pre-node "ghost").
-- It now ships as a real 1-credit node. Migration 184 added an UPDATE to fix
-- this, but 184 had ALREADY been applied to staging/prod when the node first
-- shipped, so its later-modified body never re-ran there (Supabase tracks
-- applied migrations by version, not content). This NEW migration carries the
-- correction to those environments. Idempotent — a no-op where already 1.
UPDATE model_pricing
SET credit_cost = 1, is_enabled = true
WHERE model_identifier = 'extract-audio';
