-- 583_restriction_bytes.sql
--
-- A restriction moves the bytes (581 hid the rows; 582 holds them). The
-- files on the content network are public addresses cached for a year, so
-- hiding a row is not enough: whoever has the link keeps seeing the file.
-- Restricting now MOVES each object under `evidence/<restriction id>/` (a
-- kept prefix no delete in the app removes, refused by the proxies and the
-- job gate, named by nothing but this record) and asks the edge to drop its
-- copies; a lift moves them back. What happened to each key and to the
-- purge is recorded on the restriction row, per phase, so an edge that still
-- answers, or a deployment without purge keys, is written down, not assumed.
--
--   bytes jsonb: { "restrict": <phase>, "lift": <phase> }
--   <phase>:     { "keys": { "<key>": { "state": "moved" | "restored" |
--                "skipped" | "failed", "at": <iso>, "why"?: text,
--                "error"?: text } }, "purge": { "status": "done" |
--                "not_configured" | "failed", "at": <iso>, "error"?: text } }
--
-- The record stays immutable (581's trigger) except for this column, which
-- the server writes as the bytes move — by MERGE (`merge_restriction_bytes`),
-- so the lift's phase never erases the restriction's, and two writers never
-- erase each other. Idempotent.

ALTER TABLE public.content_restrictions
  ADD COLUMN IF NOT EXISTS bytes jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.preserve_content_restriction() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  mutable text[] := ARRAY['asset_id', 'job_id', 'restricted_by', 'lifted_by', 'lifted_at', 'lift_reason', 'bytes'];
  lifting boolean := OLD.lifted_at IS NULL AND NEW.lifted_at IS NOT NULL;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A content restriction cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - mutable) = (to_jsonb(OLD) - mutable)
     AND (NEW.asset_id IS NULL OR NEW.asset_id = OLD.asset_id)
     AND (NEW.job_id IS NULL OR NEW.job_id = OLD.job_id)
     AND (NEW.restricted_by IS NULL OR NEW.restricted_by = OLD.restricted_by)
     AND (NEW.lifted_at IS NOT DISTINCT FROM OLD.lifted_at OR lifting)
     AND (NEW.lifted_by IS NOT DISTINCT FROM OLD.lifted_by OR lifting OR NEW.lifted_by IS NULL)
     AND (NEW.lift_reason IS NOT DISTINCT FROM OLD.lift_reason OR lifting)
     AND jsonb_typeof(NEW.bytes) = 'object' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A content restriction is immutable' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_content_restriction() FROM PUBLIC, anon, authenticated;

-- The one writer of `bytes`: a merge of the phase written into what is
-- there, under the row lock. Service role only.
CREATE OR REPLACE FUNCTION public.merge_restriction_bytes(p_id uuid, p_patch jsonb) RETURNS public.content_restrictions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.content_restrictions;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'merge_restriction_bytes: the patch is not an object' USING ERRCODE = '22023';
  END IF;
  UPDATE public.content_restrictions
     SET bytes = bytes || p_patch
   WHERE id = p_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_restriction_bytes: no such restriction' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.merge_restriction_bytes(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_restriction_bytes(uuid, jsonb) TO service_role;
