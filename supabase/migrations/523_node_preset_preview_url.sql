-- 523 — a user preset's example picture (`previewUrl` on /v1/node-presets).
--
-- Factory presets get theirs from committed files (frontend/public/preset-previews/,
-- served at /preset-previews/). A user preset stores the address of ITS OWN
-- copy of an image the user already has on this platform — an upload or a
-- generated result: the write routes accept only the caller's own image on the
-- deployment's media host that already exists, copy it to
-- node-presets/<userId>/ and store that copy's address
-- (backend/src/lib/presets/preview-url.ts, preview-copy.ts); the length bound
-- matches theirs. NULL = no preview.
--
-- ONLY THE SERVER WRITES IT. Every client that lists a preset loads this
-- address, so a browser holding its own session must not be able to point it
-- anywhere (another host, another user's file) by writing the row over
-- PostgREST around the routes' checks. node_presets' owner policy (191) lets a
-- user write every column of their own rows, so the column is closed by
-- privilege instead: the browser roles lose INSERT / UPDATE on the table and
-- get them back on every column EXCEPT preview_url. Nothing in the app writes
-- node_presets from a browser (every write goes through the backend's service
-- role), so the column lists only keep today's surface as it was. A new column
-- a browser should write joins these lists; preview_url never does.
--
-- RLS is unchanged. Proof: supabase/tests/node-preset-preview-url.behavior.sql.
ALTER TABLE public.node_presets
  ADD COLUMN IF NOT EXISTS preview_url TEXT CHECK (preview_url IS NULL OR char_length(preview_url) <= 2048);

REVOKE INSERT, UPDATE ON public.node_presets FROM anon, authenticated;

GRANT INSERT (id, user_id, node_type, name, description, data, group_id, tags, sort_order, created_at, updated_at)
  ON public.node_presets TO authenticated;
GRANT UPDATE (node_type, name, description, data, group_id, tags, sort_order, updated_at)
  ON public.node_presets TO authenticated;
