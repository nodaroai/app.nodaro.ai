-- Video Overlay node (video-overlay): timed image layers composited over a
-- video in one local FFmpeg pass, the base audio copied untouched.
--
-- Pricing: flat 20 credits per run, whatever the layer count or the video's
-- length (local compute, no external provider). Keyless — community installs
-- run it. Mirrors STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
-- No composites (the cost never varies).
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-overlay', 20)
ON CONFLICT (model_identifier) DO NOTHING;
