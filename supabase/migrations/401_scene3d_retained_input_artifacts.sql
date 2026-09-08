-- Retained construction inputs use the existing private artifact/pin lifecycle.
-- They are deliberately distinct from the GLBs exposed for playback.
BEGIN;
ALTER TABLE public.scene3d_artifacts DROP CONSTRAINT IF EXISTS scene3d_artifacts_kind_check;
ALTER TABLE public.scene3d_artifacts ADD CONSTRAINT scene3d_artifacts_kind_check
  CHECK (kind IN ('glb', 'camera-track-json', 'poster', 'validation-report', 'blend-source', 'source-json', 'build-manifest', 'input-glb'));
ALTER TABLE public.scene3d_upload_intents DROP CONSTRAINT IF EXISTS scene3d_upload_intents_kind_check;
ALTER TABLE public.scene3d_upload_intents ADD CONSTRAINT scene3d_upload_intents_kind_check
  CHECK (kind IN ('glb', 'camera-track-json', 'poster', 'validation-report', 'blend-source', 'source-json', 'build-manifest', 'input-glb'));
COMMIT;
