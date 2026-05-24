-- Add per-user visibility toggles for the editor's Add Node menu shortcut
-- categories. Both default to FALSE: "Recent" and "Most Used" are hidden until
-- the user opts in via Settings → Add Node Menu. (Replaces the prior
-- auto-show-on-history behavior in add-node-popup.tsx.) Set via
-- PATCH /v1/user/settings.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS show_recent_nodes BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS show_most_used_nodes BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.show_recent_nodes IS
  'Show the "Recent" shortcut category in the editor Add Node menu. Default false (hidden).';

COMMENT ON COLUMN profiles.show_most_used_nodes IS
  'Show the "Most Used" shortcut category in the editor Add Node menu. Default false (hidden).';
