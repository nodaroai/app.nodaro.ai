-- Generate Text user-defined templates (preset list). Ungated; all editions.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS text_templates JSONB NOT NULL DEFAULT '[]'::jsonb;
