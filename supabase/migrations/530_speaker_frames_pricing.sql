-- speaker-frames: its price row (P3.7, decided 2026-10-16).
--
-- Speaker Frames finds where each speaker's face is, over time, on every
-- camera of an edit (in-process face detection, no vendor: provider_cost 0).
-- It is priced per STARTED BLOCK of 1,000 sampled frames, at one rate for
-- every footage class:
--   'speaker-frames'   2  per started block of 1,000 sampled frames
-- The cloud plugin's route and the workflow run (speakerFramesCreditOverride)
-- both reserve
--   this_per_block_base × max(1, ceil(frames / 1000))
-- from a frame count the server makes: the validated edit's kept spans on the
-- ticked cameras, padded 2 s each side and merged, at 2 frames a second, or a
-- bare video's probed length × 2. The charge is the frames actually sampled,
-- at the same rate (never above the reserve). No service_margin_percent row:
-- the margin is the deployment's read-time markup.
--
-- Mirrors STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts, whose
-- value is SPEAKER_FRAMES_CREDITS_PER_BLOCK in
-- packages/render-rules/src/speaker-frames-pricing.ts (pinned to this row by
-- credit-pricing-migration-sync.test.ts).
-- ON CONFLICT DO NOTHING keeps an admin retune on re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES
  ('speaker-frames', 2)
ON CONFLICT (model_identifier) DO NOTHING;
