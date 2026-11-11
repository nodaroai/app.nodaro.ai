-- Video Overlay (video-overlay): a run with a video layer is priced per
-- started 5 seconds of the output — the base's length — on its own row,
-- `video-overlay:video`, ONE unit = 5 s (`videoOverlayVideoUnits` in
-- @nodaro/shared), the unit Mask Composite is charged by. The route and the
-- workflow run measure the base before anything is reserved; a base past 60 s
-- is refused. An image-only run keeps its flat `video-overlay` row, unchanged.
-- Mirrors STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
--
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('video-overlay:video', 10)
ON CONFLICT (model_identifier) DO NOTHING;
