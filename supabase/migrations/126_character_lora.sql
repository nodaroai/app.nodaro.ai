-- 126_character_lora.sql
***REDACTED-OSS-SCRUB***
-- All columns nullable — existing characters are untrained by default. Adds 7 columns
-- + a partial index for in-flight statuses.

BEGIN;

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS lora_replicate_version TEXT,
  ADD COLUMN IF NOT EXISTS lora_trigger_word TEXT,
  ADD COLUMN IF NOT EXISTS lora_training_status TEXT
    CHECK (lora_training_status IS NULL OR lora_training_status IN
      ('queued', 'training', 'succeeded', 'failed', 'cancelled')),
  ADD COLUMN IF NOT EXISTS lora_training_replicate_id TEXT,
  ADD COLUMN IF NOT EXISTS lora_training_error TEXT,
  ADD COLUMN IF NOT EXISTS lora_trained_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lora_training_image_count INT
    CHECK (lora_training_image_count IS NULL OR
      (lora_training_image_count >= 1 AND lora_training_image_count <= 100));

COMMENT ON COLUMN public.characters.lora_replicate_version IS
  'Replicate model version returned by ostris/flux-dev-lora-trainer on success, e.g. "nodaroai/char-<uuid>:abc123...". Used at inference via flux-lora-character.';
COMMENT ON COLUMN public.characters.lora_trigger_word IS
  'Token prepended to inference prompts, format TOK_<slug>_<6hex>. Stable for one trained version.';
COMMENT ON COLUMN public.characters.lora_training_status IS
  'queued | training | succeeded | failed | cancelled. NULL = never trained.';
COMMENT ON COLUMN public.characters.lora_training_replicate_id IS
  'Replicate trainings.create() id. Join key for webhook lookups.';

CREATE INDEX IF NOT EXISTS characters_lora_inflight_idx
  ON public.characters (lora_training_status)
  WHERE lora_training_status IN ('queued', 'training');

COMMIT;
