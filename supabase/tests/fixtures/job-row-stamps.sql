-- ============================================================================
-- Shared fixtures: what a finished job's row says about the result it made —
-- its output URL and its stamp (`jobId`, `thumbnailUrl`, and for an Apply EDL
-- render `quality` + `clipKey`). ONE list, read by BOTH implementations of the
-- rule (decided 2026-10-05):
--   - migration 459 (`mig459_job_url` / `mig459_stamp`), through the
--     "X" section of `../fan-out-row-stamps-backfill.behavior.sql`, which
--     `\ir`s this file, runs the real migration over it and checks every case;
--   - the server's load / save injection (`backend/src/lib/canvas-result-ids.ts`
--     `jobOutputUrl` / `jobRowStamp`), through
--     `backend/src/lib/__tests__/canvas-result-ids-stamp-fixtures.test.ts`,
--     which parses the rows below.
-- A change to either rule that the other does not make fails one of the two.
--
-- One case per row, one line each, valid JSON (no single quotes inside):
--   name        a slug; the proof uses `stampfx-<name>` as the node id
--   id          the job's id (the proof's uuid range, ...-0000000e7fNN)
--   job_type, input_data, output_data   the job row
--   listUrl     the URL the result row holds
--   stamp       what the row is stamped with, jobId aside; null when the job
--               did not make `listUrl` (no stamp at all)
-- ============================================================================
CREATE TEMP TABLE job_row_stamp_cases (c jsonb NOT NULL);
INSERT INTO job_row_stamp_cases (c) VALUES
  ('{"name": "render-labelled", "id": "f0000000-0000-4000-8000-0000000e7f01", "job_type": "apply-edl", "input_data": {"quality": "proxy", "clipKey": "0-1000"}, "output_data": {"videoUrl": "https://m.test/fx1.mp4", "thumbnailUrl": "https://m.test/fx1.jpg", "quality": "proxy", "clipKey": "0-1000"}, "listUrl": "https://m.test/fx1.mp4", "stamp": {"thumbnailUrl": "https://m.test/fx1.jpg", "quality": "proxy", "clipKey": "0-1000"}}'),
  ('{"name": "render-prelabel-proxy", "id": "f0000000-0000-4000-8000-0000000e7f02", "job_type": "apply-edl", "input_data": {"quality": "proxy"}, "output_data": {"videoUrl": "https://m.test/fx2.mp4", "thumbnailUrl": "https://m.test/fx2.jpg"}, "listUrl": "https://m.test/fx2.mp4", "stamp": {"thumbnailUrl": "https://m.test/fx2.jpg", "quality": "proxy"}}'),
  ('{"name": "render-prelabel-final", "id": "f0000000-0000-4000-8000-0000000e7f03", "job_type": "apply-edl", "input_data": {"quality": "final"}, "output_data": {"videoUrl": "https://m.test/fx3.mp4"}, "listUrl": "https://m.test/fx3.mp4", "stamp": {"quality": "final"}}'),
  ('{"name": "render-prelabel-no-order", "id": "f0000000-0000-4000-8000-0000000e7f04", "job_type": "apply-edl", "input_data": {}, "output_data": {"videoUrl": "https://m.test/fx4.mp4"}, "listUrl": "https://m.test/fx4.mp4", "stamp": {"quality": "final"}}'),
  ('{"name": "render-prelabel-unknown-order", "id": "f0000000-0000-4000-8000-0000000e7f05", "job_type": "apply-edl", "input_data": {"quality": "high"}, "output_data": {"videoUrl": "https://m.test/fx5.mp4"}, "listUrl": "https://m.test/fx5.mp4", "stamp": {"quality": "final"}}'),
  ('{"name": "render-audio-proxy", "id": "f0000000-0000-4000-8000-0000000e7f06", "job_type": "apply-edl", "input_data": {"quality": "proxy"}, "output_data": {"audioUrl": "https://m.test/fx6.m4a"}, "listUrl": "https://m.test/fx6.m4a", "stamp": {"quality": "proxy"}}'),
  ('{"name": "render-empty-quality", "id": "f0000000-0000-4000-8000-0000000e7f07", "job_type": "apply-edl", "input_data": {"quality": "proxy"}, "output_data": {"videoUrl": "https://m.test/fx7.mp4", "quality": "", "clipKey": ""}, "listUrl": "https://m.test/fx7.mp4", "stamp": {"quality": "proxy"}}'),
  ('{"name": "image-own-quality", "id": "f0000000-0000-4000-8000-0000000e7f08", "job_type": "generate-image", "input_data": {"quality": "high"}, "output_data": {"imageUrl": "https://m.test/fx8.png", "thumbnailUrl": "https://m.test/fx8-t.png", "quality": "high"}, "listUrl": "https://m.test/fx8.png", "stamp": {"thumbnailUrl": "https://m.test/fx8-t.png"}}'),
  ('{"name": "video-empty-image", "id": "f0000000-0000-4000-8000-0000000e7f09", "job_type": "generate-video", "input_data": {}, "output_data": {"imageUrl": "", "videoUrl": "https://m.test/fx9.mp4", "thumbnailUrl": ""}, "listUrl": "https://m.test/fx9.mp4", "stamp": {}}'),
  ('{"name": "store-typed-url", "id": "f0000000-0000-4000-8000-0000000e7f0a", "job_type": "save-to-storage", "input_data": {}, "output_data": {"url": "https://m.test/fx10.mp4", "filename": "fx10.mp4", "type": "video"}, "listUrl": "https://m.test/fx10.mp4", "stamp": {}}'),
  ('{"name": "store-json-url", "id": "f0000000-0000-4000-8000-0000000e7f0b", "job_type": "save-to-storage", "input_data": {}, "output_data": {"url": "https://m.test/fx11.json", "filename": "fx11.json", "type": "json"}, "listUrl": "https://m.test/fx11.json", "stamp": null}'),
  ('{"name": "text-output", "id": "f0000000-0000-4000-8000-0000000e7f0c", "job_type": "llm-chat", "input_data": {}, "output_data": {"text": "https://m.test/fx12.mp4"}, "listUrl": "https://m.test/fx12.mp4", "stamp": null}'),
  ('{"name": "image-before-video", "id": "f0000000-0000-4000-8000-0000000e7f0d", "job_type": "generate-video", "input_data": {}, "output_data": {"imageUrl": "https://m.test/fx13.png", "videoUrl": "https://m.test/fx13.mp4"}, "listUrl": "https://m.test/fx13.mp4", "stamp": null}');
