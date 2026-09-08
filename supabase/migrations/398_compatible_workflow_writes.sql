-- Dependency documents can only be authored through a compatible server codec.
-- Inspect OLD as well as NEW: removing the declaration is still a guarded edit.
CREATE OR REPLACE FUNCTION public.workflow_requires_compatible_writer(p_nodes jsonb, p_settings jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE((p_settings->'studio') ?| ARRAY['keyframes','sequences','settledJobIds'], false)
    OR COALESCE((p_settings->'studio'->'requiredCapabilities') ? 'studio-dependent-frames-v1', false)
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_nodes) = 'array' THEN p_nodes ELSE '[]'::jsonb END) AS n
      WHERE (n->'data') ?| ARRAY['keyframeId','sequenceBinding']
        OR (n->'data'->'requiredCapabilities') ? 'studio-dependent-frames-v1'
    );
$$;
REVOKE ALL ON FUNCTION public.workflow_requires_compatible_writer(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_requires_compatible_writer(jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_compatible_workflow_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_guarded boolean; v_role text := current_setting('role', true);
BEGIN
  v_guarded := public.workflow_requires_compatible_writer(NEW.nodes, NEW.settings);
  IF TG_OP = 'UPDATE' THEN
    IF NEW.nodes IS NOT DISTINCT FROM OLD.nodes AND NEW.edges IS NOT DISTINCT FROM OLD.edges
      AND NEW.settings IS NOT DISTINCT FROM OLD.settings THEN RETURN NEW; END IF;
    v_guarded := v_guarded OR public.workflow_requires_compatible_writer(OLD.nodes, OLD.settings);
  END IF;
  IF NOT v_guarded THEN RETURN NEW; END IF;
  -- A GUC is not a credential. Even a client which forges it and calls a
  -- SECURITY DEFINER delta RPC still has the authenticated active ROLE.
  IF current_setting('nodaro.compatible_workflow_write', true) = 'on'
    AND (v_role = 'service_role' OR (COALESCE(v_role, 'none') = 'none'
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = session_user AND rolsuper))) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'production_capability_required';
END $$;
REVOKE ALL ON FUNCTION public.guard_compatible_workflow_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_compatible_workflow_write() TO service_role;
DROP TRIGGER IF EXISTS guard_compatible_workflow_write ON public.workflows;
CREATE TRIGGER guard_compatible_workflow_write BEFORE INSERT OR UPDATE ON public.workflows
FOR EACH ROW EXECUTE FUNCTION public.guard_compatible_workflow_write();

-- Server-only transport, never a public raw-JSON editing API. The caller must
-- authorize the workflow and validate the document through its compatible codec.
-- Set the custom flag in the body: managed migration roles cannot declare an
-- unknown custom parameter in a function SET clause. Restore the prior value
-- on success; the exception block rolls back the local setting on failure.
CREATE OR REPLACE FUNCTION public.compare_and_swap_compatible_workflow(
  p_workflow_id uuid, p_expected_version integer, p_patch jsonb
) RETURNS SETOF public.workflows
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_previous text := current_setting('nodaro.compatible_workflow_write', true);
BEGIN
  IF p_expected_version IS NULL OR p_expected_version < 1 OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
    OR (p_patch - ARRAY['nodes','edges','settings','name','thumbnail_url']) <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid compatible workflow write';
  END IF;
  PERFORM set_config('nodaro.compatible_workflow_write', 'on', true);
  RETURN QUERY UPDATE public.workflows AS w SET
    nodes = CASE WHEN p_patch ? 'nodes' THEN p_patch->'nodes' ELSE w.nodes END,
    edges = CASE WHEN p_patch ? 'edges' THEN p_patch->'edges' ELSE w.edges END,
    settings = CASE WHEN p_patch ? 'settings' THEN p_patch->'settings' ELSE w.settings END,
    name = CASE WHEN p_patch ? 'name' THEN p_patch->>'name' ELSE w.name END,
    thumbnail_url = CASE WHEN p_patch ? 'thumbnail_url' THEN p_patch->>'thumbnail_url' ELSE w.thumbnail_url END
  WHERE w.id = p_workflow_id AND w.version = p_expected_version RETURNING w.*;
  PERFORM set_config('nodaro.compatible_workflow_write', COALESCE(v_previous, ''), true);
EXCEPTION WHEN OTHERS THEN
  RAISE;
END $$;
REVOKE ALL ON FUNCTION public.compare_and_swap_compatible_workflow(uuid,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compare_and_swap_compatible_workflow(uuid,integer,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.create_compatible_workflow(p_row jsonb)
RETURNS SETOF public.workflows
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_previous text := current_setting('nodaro.compatible_workflow_write', true);
BEGIN
  IF jsonb_typeof(p_row) IS DISTINCT FROM 'object'
    OR (p_row - ARRAY['project_id','user_id','name','nodes','edges','settings','thumbnail_url','app_slug']) <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid compatible workflow create';
  END IF;
  PERFORM set_config('nodaro.compatible_workflow_write', 'on', true);
  RETURN QUERY INSERT INTO public.workflows(project_id,user_id,name,nodes,edges,settings,thumbnail_url,app_slug)
  VALUES ((p_row->>'project_id')::uuid, (p_row->>'user_id')::uuid, p_row->>'name',
    COALESCE(p_row->'nodes','[]'::jsonb), COALESCE(p_row->'edges','[]'::jsonb), COALESCE(p_row->'settings','{}'::jsonb),
    p_row->>'thumbnail_url', p_row->>'app_slug') RETURNING *;
  PERFORM set_config('nodaro.compatible_workflow_write', COALESCE(v_previous, ''), true);
EXCEPTION WHEN OTHERS THEN
  RAISE;
END $$;
REVOKE ALL ON FUNCTION public.create_compatible_workflow(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_compatible_workflow(jsonb) TO service_role;
