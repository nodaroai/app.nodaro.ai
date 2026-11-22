-- 683: the per-service pricing settings of five video tools (decided 2026-11-22),
-- written by the release that reprices them (681, 682), so the price each tool
-- shows and charges is the one its docs state from the moment the release
-- lands, with no Admin step after the deploy.
--
-- The mechanism of 336's copilot entry (backend/src/ee/billing/service-margin.ts):
-- one key per price id, merged into the existing object, so every other entry
-- stays as an admin left it. Admin-editable afterwards.
-- backend/src/ee/billing/docs-price-settings.json mirrors these values.
-- Re-running is a no-op.

INSERT INTO app_settings (key, value)
VALUES (
  'service_margin_percent',
  '{"latentsync": 25, "elevenlabs-dubbing": 20, "elevenlabs-dubbing-v2": 25, "elevenlabs-voice-changer:per-10s": 25, "roop-face-swap": 25}'::jsonb
)
ON CONFLICT (key) DO UPDATE
  SET value = app_settings.value || EXCLUDED.value;
