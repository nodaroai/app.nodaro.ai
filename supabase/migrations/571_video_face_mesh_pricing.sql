-- Video Face Mesh (decided 2026-10-31): an internal step of Nodaro Motion's
-- face masking — face lines (a mesh, the lips, the eyes) drawn locally on the
-- masked or depth clip. ONE base credit per second of the clip's bucket at the
-- 30 fps basis (`videoFaceMeshCreditId`, packages/shared/src/video-face-mesh.ts;
-- backend/src/lib/video-face-mesh-length.ts; refused past 300 s, Video Mask's
-- cap). Values MUST match
-- STATIC_CREDIT_COSTS (static-costs-match-migrations.test.ts).
--
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('video-face-mesh:5s', 5, true, 'video'),
  ('video-face-mesh:10s', 10, true, 'video'),
  ('video-face-mesh:15s', 15, true, 'video'),
  ('video-face-mesh:30s', 30, true, 'video'),
  ('video-face-mesh:60s', 60, true, 'video'),
  ('video-face-mesh:120s', 120, true, 'video'),
  ('video-face-mesh:300s', 300, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
