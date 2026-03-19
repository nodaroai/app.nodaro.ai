-- Insert max_fanout_items app setting (system ceiling for fan-out)
INSERT INTO app_settings (key, value)
VALUES ('max_fanout_items', '20'::jsonb)
ON CONFLICT (key) DO NOTHING;
