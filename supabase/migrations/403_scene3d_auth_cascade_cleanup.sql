-- Auth deletion cascades execute cleanup triggers under the deleting role.
-- That role must not receive access to private artifact metadata, but the
-- triggers still need to retain cleanup tasks for the rows being deleted.
-- These parameterless trigger functions use only OLD and qualified names;
-- execution remains unavailable through the Data API.
BEGIN;
ALTER FUNCTION public.scene3d_enqueue_artifact_gc() SECURITY DEFINER;
ALTER FUNCTION public.scene3d_enqueue_artifact_gc() SET search_path = '';
ALTER FUNCTION public.scene3d_enqueue_intent_gc() SECURITY DEFINER;
ALTER FUNCTION public.scene3d_enqueue_intent_gc() SET search_path = '';

REVOKE ALL ON FUNCTION public.scene3d_enqueue_artifact_gc(),
  public.scene3d_enqueue_intent_gc() FROM PUBLIC, anon, authenticated;
COMMIT;
