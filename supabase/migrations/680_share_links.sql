-- 680_share_links.sql
--
-- Share links: anyone signed in can share ONE result (a job), a generation
-- session or a project by an unguessable link, view only. The link shows the
-- result(s), the prompt and the settings; the owner may also "allow copy",
-- which adds the reference files the result was made from.
--
-- One row per item (owner, kind, target): turning a link off stamps
-- `revoked_at` (the link answers 404), turning it on again clears it and keeps
-- the SAME token, so a link handed out before works again. The token is the
-- capability: 32 random bytes, base64url (43 characters), made by the API and
-- never derived from an id.
--
-- Service role only, like the session tables (518): RLS on, no policy, and
-- nothing granted to anon or authenticated. Every owner query in the API
-- scopes by owner_id; the public read finds a row by its token alone, which is
-- what a share link is, and then reads only that owner's item.
--
-- The target is one of three tables, so it carries no foreign key: a link to
-- a job, session or project that is gone simply reads as not found.
--
-- share_link_session_summaries: for a page of sessions in ONE call, how many
-- results a link shows and the newest of them (the cover first, when it is
-- shown), on the same rule the API applies to a single job
-- (backend/src/lib/share-links/shared-job.ts; a parity test holds the two
-- together): a live item (not removed, its job not in the Trash), a completed
-- top-level job, not restricted, not kept private, with an image, video or
-- sound, and whose prompt, prompt text and name contain none of the content
-- filter's words (passed in by the API, so the list stays in one place).
--
-- Idempotent: CI re-applies the newest migration.

CREATE TABLE IF NOT EXISTS public.share_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{43}$'),
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('job', 'session', 'project')),
  target_id   uuid NOT NULL,
  allow_copy  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  CONSTRAINT share_links_one_per_item UNIQUE (owner_id, kind, target_id)
);

COMMENT ON TABLE public.share_links IS
  'View-only share links to a job, a generation session or a project. One row per item; revoked_at set = off (404), cleared = on again with the same token. Service role only.';
COMMENT ON COLUMN public.share_links.token IS
  'The capability: 32 random bytes, base64url. Never derived from an id.';
COMMENT ON COLUMN public.share_links.allow_copy IS
  'The link also hands out the reference files the result was made from.';

ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.share_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.share_links TO service_role;

CREATE OR REPLACE FUNCTION public.share_link_session_summaries(p_session_ids uuid[], p_blocked_words text[])
RETURNS TABLE (session_id uuid, item_count bigint, recent jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH shown AS (
    SELECT i.session_id, i.job_id, j.output_data,
           row_number() OVER (
             PARTITION BY i.session_id
             ORDER BY (j.id IS NOT DISTINCT FROM s.cover_job_id) DESC, i.added_at DESC, i.job_id DESC
           ) AS rank
      FROM public.session_items i
      JOIN public.generation_sessions s ON s.id = i.session_id
      JOIN public.jobs j ON j.id = i.job_id
     WHERE i.session_id = ANY (p_session_ids)
       AND i.removed_at IS NULL
       AND i.user_id = s.user_id
       AND j.user_id = s.user_id
       AND j.deleted_at IS NULL
       AND j.status = 'completed'
       AND j.parent_job_id IS NULL
       AND j.restricted_at IS NULL
       AND j.force_private IS NOT TRUE
       AND (j.input_data -> 'forcePrivate') IS DISTINCT FROM 'true'::jsonb
       AND (j.input_data -> 'force_private') IS DISTINCT FROM 'true'::jsonb
       AND (coalesce(j.output_data ->> 'videoUrl', '') ~* '^https?://'
            OR coalesce(j.output_data ->> 'imageUrl', '') ~* '^https?://'
            OR coalesce(j.output_data ->> 'audioUrl', '') ~* '^https?://'
            OR coalesce(j.output_data -> 'videoUrls' ->> 0, '') ~* '^https?://'
            OR coalesce(j.output_data -> 'imageUrls' ->> 0, '') ~* '^https?://'
            OR coalesce(j.output_data -> 'audioUrls' ->> 0, '') ~* '^https?://')
       AND NOT EXISTS (
         SELECT 1
           FROM unnest(coalesce(p_blocked_words, '{}'::text[])) AS w(word),
                unnest(ARRAY[
                  CASE WHEN jsonb_typeof(j.input_data -> 'prompt') = 'string' THEN j.input_data ->> 'prompt' END,
                  CASE WHEN jsonb_typeof(j.input_data -> 'userPrompt') = 'string' THEN j.input_data ->> 'userPrompt' END,
                  CASE WHEN jsonb_typeof(j.input_data -> 'text') = 'string' THEN j.input_data ->> 'text' END,
                  j.title
                ]) AS t(said)
          WHERE length(w.word) > 0
            AND t.said IS NOT NULL
            AND strpos(lower(t.said), lower(w.word)) > 0
       )
  )
  SELECT s.id,
         (SELECT count(*) FROM shown WHERE shown.session_id = s.id),
         coalesce((
           SELECT jsonb_agg(jsonb_build_object('job_id', shown.job_id, 'output_data', shown.output_data) ORDER BY shown.rank)
             FROM shown
            WHERE shown.session_id = s.id AND shown.rank <= 5
         ), '[]'::jsonb)
    FROM unnest(p_session_ids) AS s(id)
$$;

REVOKE ALL ON FUNCTION public.share_link_session_summaries(uuid[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.share_link_session_summaries(uuid[], text[]) FROM anon;
REVOKE ALL ON FUNCTION public.share_link_session_summaries(uuid[], text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.share_link_session_summaries(uuid[], text[]) TO service_role;
