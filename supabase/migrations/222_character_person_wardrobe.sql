-- Structured Person + Wardrobe selections for characters (Character Studio redesign).
-- Both nullable JSONB; derived into generation prompts server-side. RLS unaffected (column adds).
ALTER TABLE characters ADD COLUMN IF NOT EXISTS person jsonb;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS wardrobe jsonb;
