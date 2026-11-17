-- Gemini Omni Flash 1.2 Extend (extend-video node, provider
-- gemini-omni-flash-1-2-extend) is charged per second of video it sends and
-- adds: the source's last 10 seconds (or all of a shorter source) at the
-- per-second-sent row, plus the seconds added at the resolution's
-- per-second-added row, the total rounded up to the next 10 once. A whole run
-- is quoted under its own id (gemini-omni-flash-1-2-extend:<res>:sent-<S>s:added-<A>s),
-- priced from these same rows, so it has no rows of its own. The same figures
-- as STATIC_CREDIT_COSTS (static-costs-match-migrations.test.ts).
--
-- ON CONFLICT DO NOTHING keeps any admin override, and makes a second run a
-- no-op.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('gemini-omni-flash-1-2-extend:source:per-second', 5, true, 'video'),
  ('gemini-omni-flash-1-2-extend:360p:per-second', 15, true, 'video'),
  ('gemini-omni-flash-1-2-extend:720p:per-second', 42, true, 'video'),
  ('gemini-omni-flash-1-2-extend:1080p:per-second', 63, true, 'video'),
  ('gemini-omni-flash-1-2-extend:4k:per-second', 125, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
