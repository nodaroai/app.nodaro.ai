-- 226_claim_character_lora_training.sql
--
-- Atomic CAS slot-claim for Character LoRA training.
--
-- Why an RPC instead of the bare supabase-js UPDATE the route used before:
-- PostgREST mis-compiles an UPDATE that carries BOTH an `or=` filter AND a
-- representation/RETURNING (`.select()`): it qualifies the predicate column as
-- `characters.lora_training_status` in a scope where that alias is not valid,
-- so Postgres raises 42703 ("column characters.lora_training_status does not
-- exist"). The route's claim was exactly that shape —
--   .update({...}).eq().eq().is()
--   .or("lora_training_status.is.null,lora_training_status.in.(succeeded,failed,cancelled)")
--   .select("id")
-- — so EVERY POST /v1/characters/:id/train 500'd (silently: the handler
-- discarded the error and sent { error: "claim_failed" }). Either piece alone
-- works; only the combination fails. Running the identical conditional
-- UPDATE...RETURNING as a function body sidesteps PostgREST's filter SQL-gen
-- entirely and is the atomic-claim pattern this codebase already uses
-- (cf. claim_job_finalize, migration 210).
--
-- Wins  -> stamps lora_training_status='queued', clears the prior error, and
--          returns the character id.
-- Loses -> matches zero rows (in-flight: queued/training, or not found / not
--          owned / soft-deleted) and returns NULL.
-- Single UPDATE = atomic CAS: concurrent callers serialize on the row lock and
-- the second re-evaluates the predicate against the fresh status (TOCTOU-free).
--
-- Idempotent: CREATE OR REPLACE + re-asserted REVOKE/GRANT.

CREATE OR REPLACE FUNCTION public.claim_character_lora_training(
  p_character_id uuid,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.characters
  SET lora_training_status = 'queued',
      lora_training_error = NULL,
      updated_at = now()
  WHERE id = p_character_id
    AND user_id = p_user_id
    AND deleted_at IS NULL
    AND (
      lora_training_status IS NULL
      OR lora_training_status IN ('succeeded', 'failed', 'cancelled')
    )
  RETURNING id INTO v_id;

  RETURN v_id;  -- NULL when the slot was not claimable / row not owned
END;
$$;

-- Backend service-role only — clients must never claim a training slot directly.
REVOKE EXECUTE ON FUNCTION public.claim_character_lora_training(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_character_lora_training(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_character_lora_training(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_character_lora_training(uuid, uuid) TO service_role;
