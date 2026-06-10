-- Named Character Boards: dense reference sheets (one per persona/look, e.g.
-- "Evening gown" / "Beach run") generated from the character's images via the
-- generate-image/character-board factory preset. A first-class {name,url}[]
-- bucket like expressions/poses — NOT the opaque selected_asset_by_variant map
-- Studio previously squatted on — so the community pipeline can carry boards:
-- publish snapshots them (R2-copied via the adapter assetFields) and clone
-- hands every consumer their own starting set to extend.
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS boards JSONB NOT NULL DEFAULT '[]'::jsonb;
