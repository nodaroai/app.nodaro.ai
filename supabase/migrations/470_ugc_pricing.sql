-- UGC video nodes (Cloud only; a private plugin serves them).
--
-- ugc-script: one flat price per run of the UGC Script node, however many
-- rewrites it takes; a run that cannot meet the video rules is refunded.
-- ugc-clip: a placeholder row. A clip is admitted with a computed ceiling that
-- replaces this price; the row exists so the price lookup before that override
-- never fails. It is never charged and never shown.
-- ugc-creator, ugc-clips, ugc-cards: free nodes. Their paid steps run as their
-- own jobs, each priced under its own row; these rows hold the node types at 0.
--
-- Mirrors STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts.
-- ON CONFLICT DO NOTHING: an administrator's retune survives re-application.
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES
  ('ugc-script', 20),
  ('ugc-clip', 0),
  ('ugc-creator', 0),
  ('ugc-clips', 0),
  ('ugc-cards', 0)
ON CONFLICT (model_identifier) DO NOTHING;
