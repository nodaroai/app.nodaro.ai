-- 370_app_reports_triage_close_out.sql
-- Data triage for the 2026-09-01 app-reports export (420 rows, status='new',
-- exported 2026-09-01T12:34:57.534Z). Spec: the 2026-09-01 app-reports
-- triage design, §9 (internal planning doc).
--
-- WHAT THIS CLOSES. Only the two fully-decidable buckets: 27 rows whose defect
-- was already fixed or is stale ('resolved') and 87 rows that are correct
-- behaviour or live in @nodaroai/cloud-plugins
-- ('dismissed') — 114 rows in all. The other 306 are NOT touched here: 255 go
-- to 'reviewed' and 16 more to 'dismissed' through the paging script (the admin
-- API has no bulk update), and 35 stay 'new' on purpose, still blocked on the W0
-- provider-error data. Whole-export result after both lanes: 27 resolved /
-- 103 dismissed / 255 reviewed / 35 new.
--
-- WHY A MIGRATION. Statuses are operational data, but the migration lane is
-- the sanctioned prod-write path — precedent 263_picker_gaps_triage_first_batch
-- and 364_picker_gaps_triage_second_batch. The admin API filters by
-- kind/appSlug/node/status/userId only and PATCHes one id at a time.
--
-- THE created_at BOUND IS LOAD-BEARING. The failure sweep keeps writing rows
-- with byte-identical error text every hour. Without
-- `created_at <= '2026-09-01T12:34:57.534Z'` these predicates would also close
-- rows nobody triaged — and, worse, silently resolve a REGRESSION of one of
-- the fixed defects. Every statement below carries it.
--
-- Idempotent: only rows still status='new' are touched, so a re-apply is a
-- no-op and a fresh / self-hosted database matches nothing at all.
-- No DDL, no RLS change, no GRANT.

-- ===========================================================================
-- RESOLVED — 27 rows
-- ===========================================================================

-- R-B1 · B1 extract-frame ENOENT · 7 rows
--   FIXED on dev 08-18 05:38Z (1649f13f9); every row failed 08-17 20:56-22:52Z —
--   the pre-deploy tail.
UPDATE app_reports SET status = 'resolved'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '46981f1b-34df-4f2c-9150-8bf0a536243e',
      '494b981a-df61-4f56-99e0-fec523af3327',
      '556bfa1f-22b7-4c06-8fc6-3f1dba047992',
      'b51cf4c9-8815-4e64-94c2-2bc3b683aebf',
      'b716f407-6291-4ddf-8fe9-8878d8d435be',
      'b8296bab-5522-4e0f-83c6-688adf0a1c53',
      'd58effdc-f485-43dc-a2b7-26924578a0ab'
    );

-- R-B9 · B9 ffprobe moov + two 07-20 ffmpeg rows · 3 rows
--   STALE: the two 07-20 rows were mis-filed model-rejection by the old bare
--   `filtered` pattern (fixed 335bad49c #295); the ffprobe row is a broken
--   upload. Spec §9 files all three `resolved`.
UPDATE app_reports SET status = 'resolved'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '31304a6f-bd64-4468-bc8e-ce4140113631',
      '39fd72db-08ed-4013-bf85-8b3ccea76bf6',
      'f53ba964-2a9a-4edb-824d-6b05db42f5e2'
    );

-- R-B10 · B10 yt-dlp JS runtime · 1 row
--   FIXED b67cd2386 #960 (08-25 12:52) — both lanes ladder web→tv→android. No
--   job id on the row.
UPDATE app_reports SET status = 'resolved'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND kind = 'job-failure' AND job_id IS NULL
    AND strpos(payload->>'error', 'No supported JavaScript runtime') > 0;

-- R-B12 · B12 VCP FFmpeg merge failed · 3 rows
--   FIXED in core 4de3ab561 #1069 (08-30 17:37): NoVideoStreamError +
--   probe-before-merge. Residual stderr persistence is W0, not these rows.
UPDATE app_reports SET status = 'resolved'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '47fffad7-798f-4744-af02-b73bacb27573',
      'aa5b956b-2482-4cca-b12a-ab34bb6087d1',
      'dcd724fd-e31c-4f3d-9fc7-967d87a71046'
    );

-- R-P7T2V · P7 text-to-video userPrompt cap · 4 rows
--   FIXED e59ead1ea #855 (main 08-21 15:07Z); the four rows are 14:09-14:56Z. No
--   job id (rejected at the route).
UPDATE app_reports SET status = 'resolved'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND kind = 'validation-reject' AND payload->>'route' = '/v1/text-to-video';

-- R-S1STALE · S1 pre-2026-07-19 wording · 2 rows
--   The two 07-18 rows used wording rewritten 2026-07-19 (2087527ae) and pinned
--   absent by person-exposure-hints.test.ts.
UPDATE app_reports SET status = 'resolved'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '1dbf5be0-4f2d-48a5-92b6-32e429cc317e',
      'bead537e-591c-43d6-a4a1-ea22f0553efc'
    );

-- R-B2STILL · B2 unknown job type still-to-video · 1 row
--   STALE: a dev-machine worker on older code; the handler landed b49a7ffe6 on
--   08-21.
UPDATE app_reports SET status = 'resolved'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '7996c7d4-dbbf-475c-8767-88e6f1a0fc4e'
    );

-- R-B7DUP · B7 recast duplicate (pre-fork path) · 2 rows
--   STALE: both rows are 08-25, before the 08-28 fork path replaced this code.
UPDATE app_reports SET status = 'resolved'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND kind = 'internal-error' AND payload->>'route' = '/v1/recast/:id/duplicate';

-- R-H1ADD · H1 picker gaps added · 4 rows
--   Migration 364 already marked these rows' gap items 'added' in
--   picker_catalog_gaps; only the app_reports rows stayed new.
UPDATE app_reports SET status = 'resolved'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '33b45bd9-890e-4836-ba16-9b18a469b5f2',
      '9c7f7f05-f13e-4617-9ce1-b2bb4270daa7',
      'bde12992-96e0-4e7e-b245-87b3a5209767',
      'f9618930-6e8d-4585-8340-42633102e611'
    );

-- ===========================================================================
-- DISMISSED — 87 rows
-- ===========================================================================

-- D-U1 · U1 insufficient credits · 10 rows
--   EXPECTED. Every insufficient-credits row in the export is this cluster, so
--   the kind alone is the predicate.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND kind = 'insufficient-credits';

-- D-U2 · U2 app-credit reservation failed · 2 rows
--   EXPECTED — a published app run out of app credits.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND kind = 'execution-failure' AND strpos(payload->>'error', 'Credit reservation failed') > 0;

-- D-U4 · U4 input file exceeds size/duration · 5 rows
--   EXPECTED — provider limit; the pre-check UX note is not a row-level action.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '19c55b68-8c9f-4281-8e96-67ce9e8da42c',
      '571b9ea5-1f76-4cf0-a259-542a1ac978fd',
      '9dfd2f50-b45b-497b-93b5-6f5f2127d78d',
      'de41b5fc-8eff-4800-be91-45bedc001fbf',
      'fffdb935-a465-4680-813c-b9c8a3a71931'
    );

-- D-U5 · U5 VCP no speech detected · 4 rows
--   EXPECTED — the message is already actionable.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '4a784972-c010-4185-838c-88d07b0c3b79',
      '74e070ac-dc0b-40a4-b1c9-682a292ce807',
      'a279145c-f171-4a99-952e-1999791a2843',
      'f1e49743-cb4e-4827-b478-a3c44ebdda17'
    );

-- D-U6 · U6 image-proxy missing url · 2 rows
--   EXPECTED — unauthenticated bot traffic; W0 adds a route skip so it stops
--   being reported.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND kind = 'validation-reject' AND payload->>'route' = '/v1/image-proxy';

-- D-U7 · U7 stopped by user · 2 rows
--   EXPECTED.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '0ceea54d-e28c-4d6f-8032-f06ea2b0fec0',
      '50b0d219-2e29-43bb-b7dc-0d9995a1dce0'
    );

-- D-U8 · U8 ElevenLabs blocked voice · 2 rows
--   EXPECTED — voice_access_denied is an account-side permission.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '1d830e59-3c55-4b03-b441-329c1a98ce9d',
      'aaae74f1-92a8-4122-b8df-84435cb205b7'
    );

-- D-G2 · G2 generation timed out · 2 rows
--   EXPECTED.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '0ac6d041-c021-438c-bca8-dbee4eb46e5c',
      '67111e03-0151-4d8f-9c2d-a4f1a0f0d273'
    );

-- D-P9 · P9 VCP re-speak, stale analysis · 2 rows
--   EXPECTED (plugin surface); the message already tells the user to re-run
--   analyze.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND kind = 'validation-reject' AND payload->>'route' = '/v1/voice-changer-pro'
    AND strpos(payload->>'message', 'orderedVoices:') > 0;

-- D-P10A · P10 app-run PATCH invalid parameters · 1 row
--   EXPECTED — a malformed client PATCH.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND kind = 'validation-reject' AND payload->>'route' = '/v1/app/:slug/runs/:runId';

-- D-P10B · P10 VCP videoUrl invalid · 1 row
--   EXPECTED — client sent a non-URL.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND kind = 'validation-reject' AND payload->>'route' = '/v1/voice-changer-pro'
    AND strpos(payload->>'message', 'videoUrl:') > 0;

-- D-P10C · P10 generate-video private/loopback URL · 1 row
--   EXPECTED — SSRF guard doing its job. The message discriminates this row from
--   P8's three `imageUrl is required` rows on the same route+kind, which are
--   `reviewed`.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND kind = 'validation-reject' AND payload->>'route' = '/v1/generate-video'
    AND strpos(payload->>'message', 'must use http(s)') > 0;

-- D-H1DIS · H1 picker gaps dismissed-with-route · 3 rows
--   Migration 364 dismissed these rows' gap items (routed to another picker);
--   the app_reports rows stayed new.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '6214bd8d-039c-4ca4-b66a-2939ae4dd9e0',
      '8c32804c-0436-4cff-998a-c3277b0efee9',
      'c52cd666-f49d-4a2d-8d7a-edd6998c4aa1'
    );

-- D-B4 · B4 VCP jobs_workflow_id_fkey · 2 rows
--   EXT — plugin-side raw inserts (cloud-plugins ticket); no core row-level
--   action.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND kind = 'internal-error' AND payload->>'route' = '/v1/voice-changer-pro'
    AND strpos(payload->>'message', 'jobs_workflow_id_fkey') > 0;

-- D-B7RESCORE · B7 recast rescore · 2 rows
--   EXT — cloud-plugins ticket.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '3e105ffa-e856-4ac2-ad66-2ac236d79bce',
      '545647c5-1266-493a-8c42-c12627e81906'
    );

-- D-B7FORK · B7 recast fork, media gone · 1 row
--   EXT — the 08-31 row is on the new fork path; cloud-plugins ticket. No job
--   id.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND kind = 'job-failure' AND job_id IS NULL
    AND payload->>'error' = 'This recast''s media is no longer available, so it can''t be duplicated.';

-- D-B7WF · B7 GET /v1/workflows/:id · 1 row
--   EXT — recast-side fetch failure; cloud-plugins ticket.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND kind = 'internal-error' AND payload->>'route' = '/v1/workflows/:id';

-- D-B11 · B11 gvp/recast resume races · 5 rows
--   Split at §7: the core half is W4/B6's Worker options (tracked by PR 7, not
--   by these rows); the handler half is a cloud-plugins ticket.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '1c4be8ef-b6f9-46bc-954f-c4b2715435f6',
      '2ac4ecf2-6ae7-42c7-83ea-2b47327b10f7',
      '4b789652-3401-4677-bb57-dcc835d73ecf',
      '8b7683e4-9c48-43d4-862d-b0289535f734',
      'c388a40c-1d56-4590-9513-6f1227214b5b'
    );

-- D-P1GVP · P1 seedance-2 gvp segment retries · 4 rows
--   EXT lane — the gvp segment stack lives in cloud-plugins; the core
--   aspect-ratio fix (PR 4/5) does not close these.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '099a2b87-6caf-4661-a1bb-d93881a6ba4c',
      '1f1edd1e-6826-4b56-8ab5-8ce684c32d34',
      '21a4eecc-be79-4693-90d1-3b854ea2489d',
      'c86cbbfb-ae6e-4e24-9ae3-01ee4426869c'
    );

-- D-P6PREV · P6 ElevenLabs previous_text · 1 row
--   EXT — the VCP re-speak stitching call is plugin-side (cloud-plugins ticket +
--   a rev of the v3 dubbing spec).
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '3a7e470e-3e53-4d9b-8afd-a62c788431b2'
    );

-- D-S2 · S2 copyright screens (non-likeness) · 34 rows
--   EXPECTED — provider copyright screens on real songs / TV sets. The three
--   likeness rows are deliberately excluded and stay `new` as §3.4/§6.5
--   evidence.
UPDATE app_reports SET status = 'dismissed'
 WHERE status = 'new' AND created_at <= '2026-09-01T12:34:57.534Z'
   AND job_id IN (
      '00142a7c-1122-4c60-86ea-7667628d8d84',
      '0a4b2b4f-c20b-4fee-aea7-4c3793e807f9',
      '182428a5-174a-4506-89c9-3f5fb0e1ff21',
      '1e1e26eb-9c64-4685-85cb-22c2ae0df630',
      '23402c53-e747-41d3-a346-ffab3aad5eb5',
      '3ea57b34-89e5-4097-9be3-1ad1651a1208',
      '443f6284-99da-449e-af2e-11ccd6002105',
      '4e56ef7f-59df-40d5-92dc-f35b48ce85c4',
      '4eaa191c-c6da-476d-ac3a-180c050ab243',
      '68c19903-452b-47b1-b874-639882c671be',
      '6dfcc9f9-3ace-4646-aa0b-3042a07bcc34',
      '71c5ec9a-2a8f-4a54-bdf5-9c57e277131c',
      '7a2d3af9-f768-495b-9f01-9fcc3c9be65d',
      '8af1b6b8-5f0b-4f24-b537-a1dd3f62d3f8',
      '8f7396b1-9f0e-424b-95f1-b194dc1bb560',
      '8f7d137a-7220-4f57-bf19-ab93e218f52c',
      '987f621a-1a23-4e76-8719-c39bb6b63ace',
      '9aad0cfe-7045-437e-8069-548899607b20',
      'b24b556e-c2a2-4a8c-aa7d-e336e59b9410',
      'b5ce1baa-e597-4cfb-a97b-903c6304d5a3',
      'b7504007-729e-404c-869b-922604fe72b0',
      'cf3e6d0e-5436-46c3-be52-ac0fe5ae15cd',
      'cf777a0a-07a1-4416-8d26-0f6af350bfc7',
      'd489f02b-6179-426d-8b78-48e51d999162',
      'd57f4174-fbe6-4186-aa71-37a6ab2f7f94',
      'dba3a6db-9dfc-4be0-91cf-03c566a8272b',
      'df080271-033c-4313-8e60-ee4fd3e4216e',
      'e0a4ebaa-fbd4-41f6-af2c-350d3eb332b2',
      'e2dd49e7-b576-483d-882c-04e57342b5f2',
      'e80efcce-262b-46c5-b023-421ada4e0af3',
      'f1e1f114-a5e1-437a-a4ee-0e14356a9937',
      'f21db892-c583-41b8-a471-98b735c1b98f',
      'f5899b99-abf9-4790-be6b-83dd03e6299e',
      'f5fe72d6-c189-4581-a2dc-64fc70d8c66e'
    );

