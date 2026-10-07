-- 482_scene_url_ownership.sql
--
-- A scene's storage URLs in `pipeline_entities.metadata.scene_node_data` name
-- only the pipeline owner's objects (decided 2026-10-07). 480 holds the asset
-- IDS there to the owner's assets; the urls beside them (`keyframe_url`,
-- `video_url`, `last_frame_url`, `audio_url`, `lipsynced_url`,
-- `bridged_frame_url`, `composite_video_url`, `interpolation_keyframe_urls`
-- and the `url` of every asset ref) are what the server actually downloads and
-- forwards: the start frame and references sent to a video model, the
-- keyframes a critic looks at, the composites ffmpeg concatenates. The rule
-- is by key, like the ids: any key named `url` or ending in `_url` or
-- `_urls`, at any depth, with a string (or an array of strings) as its value.
--
-- Its own file because it runs after 481: the count below and the trigger ask
-- `assets` by `r2_key`, which has an index only from 481 on.
--
-- WHOSE OBJECT A URL NAMES. The rule is backend/src/lib/key-ownership.ts's,
-- asked of the URL's path. The database does not know which hosts are ours,
-- so it judges the path of every URL, and a URL elsewhere whose path names
-- another user's job is refused too. The backend's write-side pre-checks
-- (a seed, a branch, the Scene Director) ask the same of every host, with a
-- port of these functions, so a write they let through is one this trigger
-- accepts (review round, decided 2026-10-07):
--   - read as a browser reads it: C0 controls and spaces trimmed, tabs and
--     newlines removed, `\` read as `/`;
--   - a URL's `url` query parameters are judged too (our own public proxy
--     routes serve whatever object that parameter names);
--   - made by: the path's last segment is the key family of a job
--     (`<jobId>` or `<jobId>-<suffix>`, extension removed), or the path holds
--     the per-user upload namespace (`uploads/[handoff/]<kind>/<userId>/`).
--     Another user made it: foreign. The owner made it: the owner's, whoever
--     else's library also holds it.
--   - claimed by: with no maker known, the EARLIEST `assets` row naming the
--     path (or a tail of it, from a `/`) as its `r2_key` decides; another
--     user's row at least as early as every row of the owner's makes it
--     foreign. (Any user can save any url to their library, so a later row
--     must not take an object from the user who uploaded it.)
--   - neither: nobody claims it, and it is not foreign.
-- The path is percent-decoded (ASCII only — keys are ASCII), so an encoded
-- spelling of another user's key is judged as that key.
--
-- Rows written before this migration are counted, not changed (decided
-- 2026-10-07): every reader that downloads or forwards one asks whose object
-- it is first (backend/src/lib/pipeline-asset-ownership.ts), and drops it.
-- ---------------------------------------------------------------------------

-- Every url a scene names, by key.
CREATE OR REPLACE FUNCTION public.scene_node_data_urls(p_scene jsonb)
RETURNS SETOF text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN jsonb_typeof(q.v) = 'string' THEN q.v #>> '{}' END
  FROM jsonb_path_query(
         p_scene,
         'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "(^|_)urls?$").value'
       ) AS q(v)
  WHERE jsonb_typeof(q.v) = 'string'
  UNION ALL
  SELECT e.v #>> '{}'
  FROM jsonb_path_query(
         p_scene,
         'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "(^|_)urls?$").value'
       ) AS q(v)
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(q.v) = 'array' THEN q.v ELSE '[]'::jsonb END) AS e(v)
  WHERE jsonb_typeof(e.v) = 'string'
$$;

-- A URL as a browser reads it before parsing it (review round, decided
-- 2026-10-07): leading and trailing C0 controls and spaces trimmed, every
-- ASCII tab, newline and carriage return removed, every `\` read as `/`.
-- fetch, the providers and the backend's URL parser all do this (WHATWG), so
-- `images\<jobId>.png` and a key with a tab inside it name the same object as
-- the plain spelling; judged without it they named no one.
CREATE OR REPLACE FUNCTION public.storage_url_normalize(p_url text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT
SET search_path = public
AS $$
  SELECT replace(
           regexp_replace(
             regexp_replace(p_url, '^[\x01-\x20]+|[\x01-\x20]+$', '', 'g'),
             '[\t\n\r]', '', 'g'),
           chr(92), '/')
$$;

-- `p`, its ASCII percent-escapes decoded (keys are ASCII; any other escape is
-- left as it stands).
CREATE OR REPLACE FUNCTION public.storage_url_ascii_decode(p text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT string_agg(
             CASE
               WHEN m.tok[1] ~ '^%[0-9A-Fa-f]{2}$'
                    AND ('x' || substr(m.tok[1], 2))::bit(8)::int BETWEEN 1 AND 127
               THEN chr(('x' || substr(m.tok[1], 2))::bit(8)::int)
               ELSE m.tok[1]
             END,
             '' ORDER BY m.ord)
    FROM regexp_matches(p, '%[0-9A-Fa-f]{2}|[^%]+|%', 'g') WITH ORDINALITY AS m(tok, ord)
  ), '')
$$;

-- A URL's path, without scheme, host, query or fragment, percent-decoded
-- (ASCII escapes only), without leading slashes. Normalized first, as above.
CREATE OR REPLACE FUNCTION public.storage_url_path(p_url text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT
SET search_path = public
AS $$
  SELECT regexp_replace(
    public.storage_url_ascii_decode(
      regexp_replace(
        regexp_replace(public.storage_url_normalize(p_url), '^[A-Za-z][A-Za-z0-9+.-]*://[^/?#]*', ''),
        '[?#].*$', '')),
    '^/+', '')
$$;

-- Every `url` query parameter of a URL, decoded as a query string is (`+` is
-- a space, then ASCII escapes; the key is decoded the same way, so `%75rl`
-- is `url`), in order (review round, decided 2026-10-07). Our own public
-- proxy routes (`/v1/download?url=`, `/v1/image-proxy?url=`) serve whatever
-- object their `url` names, so a URL carrying one is judged by it too — on
-- any host, as the database does not know which hosts are ours.
CREATE OR REPLACE FUNCTION public.storage_url_query_urls(p_url text)
RETURNS SETOF text
LANGUAGE sql IMMUTABLE STRICT
SET search_path = public
AS $$
  SELECT public.storage_url_ascii_decode(replace(
           CASE WHEN strpos(q.part, '=') > 0 THEN substr(q.part, strpos(q.part, '=') + 1) ELSE '' END,
           '+', ' '))
  FROM regexp_split_to_table(
         coalesce(substring(public.storage_url_normalize(p_url) from '^[^#?]*\?([^#]*)'), ''),
         '&') WITH ORDINALITY AS q(part, ord)
  WHERE public.storage_url_ascii_decode(replace(split_part(q.part, '=', 1), '+', ' ')) = 'url'
  ORDER BY q.ord
$$;

-- True when the object `p_url` names (or the object any of its `url` query
-- parameters names) was made by, or (no maker known) is claimed first by, a
-- user other than `p_owner`. Mirrors key-ownership.ts.
CREATE OR REPLACE FUNCTION public.storage_url_is_foreign(p_url text, p_owner uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_path  text := public.storage_url_path(p_url);
  v_stem  text;
  v_ns    text;
  v_maker uuid;
  v_made  boolean := false;
  v_tails text[];
BEGIN
  -- A proxy url is the url it carries. Each inner url is shorter than the one
  -- carrying it, so this ends.
  IF EXISTS (
    SELECT 1 FROM public.storage_url_query_urls(p_url) AS q(u)
    WHERE public.storage_url_is_foreign(q.u, p_owner)
  ) THEN
    RETURN true;
  END IF;

  IF v_path IS NULL OR v_path = '' THEN
    RETURN false;
  END IF;

  v_ns := substring(v_path from '(?:^|/)uploads/(?:handoff/)?[^/]+/([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})/');
  IF v_ns IS NOT NULL THEN
    IF lower(v_ns) <> p_owner::text THEN
      RETURN true;
    END IF;
    v_made := true;
  END IF;

  v_stem := regexp_replace(regexp_replace(v_path, '^.*/', ''), '^(.+)\.[^.]*$', '\1');
  IF left(v_stem, 36) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND (length(v_stem) = 36 OR substr(v_stem, 37, 1) = '-') THEN
    SELECT j.user_id INTO v_maker FROM public.jobs j WHERE j.id = left(v_stem, 36)::uuid;
    IF FOUND THEN
      IF v_maker IS DISTINCT FROM p_owner THEN
        RETURN true;
      END IF;
      v_made := true;
    END IF;
  END IF;

  IF v_made THEN
    RETURN false;
  END IF;

  -- The whole path, and every tail of it that starts after a `/` and still
  -- holds one (a bucket prefix on the public host is not part of the key).
  SELECT array_agg(t) INTO v_tails
  FROM (
    SELECT v_path AS t
    UNION
    SELECT array_to_string(parts[i:], '/')
    FROM (SELECT string_to_array(v_path, '/') AS parts) s,
         generate_series(2, greatest(array_length(parts, 1) - 1, 1)) AS i
    WHERE array_length(parts, 1) > 2
  ) x;

  -- No maker: the key belongs to its EARLIEST library claimant (review round,
  -- decided 2026-10-07). Any user can save any url to their library, so "held
  -- by another user" alone let a stranger's later save take the owner's own
  -- upload from them. Foreign when another user's row is at least as early as
  -- every row of the owner's (a tie cannot be told apart, so it is foreign).
  RETURN EXISTS (
    SELECT 1 FROM public.assets a
    WHERE a.r2_key = ANY (v_tails)
      AND a.user_id IS NOT NULL
      AND a.user_id <> p_owner
      AND NOT EXISTS (
        SELECT 1 FROM public.assets o
        WHERE o.r2_key = ANY (v_tails)
          AND o.user_id = p_owner
          AND o.created_at < a.created_at
      )
  );
END;
$$;

-- The backend's service role is the only writer of pipeline entities; the
-- browser roles can neither call these nor use them as an oracle.
REVOKE ALL ON FUNCTION public.scene_node_data_urls(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.scene_node_data_urls(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.storage_url_path(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.storage_url_path(text) TO service_role;
REVOKE ALL ON FUNCTION public.storage_url_normalize(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.storage_url_normalize(text) TO service_role;
REVOKE ALL ON FUNCTION public.storage_url_ascii_decode(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.storage_url_ascii_decode(text) TO service_role;
REVOKE ALL ON FUNCTION public.storage_url_query_urls(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.storage_url_query_urls(text) TO service_role;
REVOKE ALL ON FUNCTION public.storage_url_is_foreign(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.storage_url_is_foreign(text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Count first: scenes that already name another user's object by url.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_scene_urls INT;
BEGIN
  SELECT COUNT(*) INTO v_scene_urls
  FROM public.pipeline_entities e
  JOIN public.pipelines p ON p.id = e.pipeline_id
  WHERE e.metadata ? 'scene_node_data'
    AND EXISTS (
      SELECT 1 FROM public.scene_node_data_urls(e.metadata->'scene_node_data') AS u(url)
      WHERE public.storage_url_is_foreign(u.url, p.user_id)
    );

  RAISE NOTICE 'scene entities whose scene_node_data names another user''s storage url (kept; every reader that downloads or forwards one asks whose it is): %', v_scene_urls;
END $$;

-- ---------------------------------------------------------------------------
-- The invariant, for every writer — the service role included. 480's checks
-- unchanged; the scene's urls join them. Like the ids, what changed is judged
-- by value: a url the row already held (anywhere in its scene data) is not
-- judged again, so a reorder or a write that keeps a planted url passes; an
-- insert or a move to another pipeline judges every url.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pipeline_entities_asset_owner_check()
RETURNS TRIGGER AS $$
DECLARE
  v_moved       boolean := TG_OP = 'INSERT' OR NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id;
  v_attempt     text := NEW.metadata->>'last_attempted_asset_id';
  v_old_attempt text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.metadata->>'last_attempted_asset_id' END;
  v_scene       jsonb := NEW.metadata->'scene_node_data';
  v_old_scene   jsonb := CASE WHEN TG_OP = 'UPDATE' THEN OLD.metadata->'scene_node_data' END;
  v_owner       uuid;
BEGIN
  SELECT p.user_id INTO v_owner FROM public.pipelines p WHERE p.id = NEW.pipeline_id;

  IF NEW.main_asset_id IS NOT NULL
     AND (v_moved OR NEW.main_asset_id IS DISTINCT FROM OLD.main_asset_id)
     AND NOT EXISTS (
    SELECT 1 FROM public.assets a
    WHERE a.id = NEW.main_asset_id AND a.user_id = v_owner
  ) THEN
    RAISE EXCEPTION 'pipeline_entities.main_asset_id must name an asset of the pipeline''s owner'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.last_frame_asset_id IS NOT NULL
     AND (v_moved OR NEW.last_frame_asset_id IS DISTINCT FROM OLD.last_frame_asset_id)
     AND NOT EXISTS (
    SELECT 1 FROM public.assets a
    WHERE a.id = NEW.last_frame_asset_id AND a.user_id = v_owner
  ) THEN
    RAISE EXCEPTION 'pipeline_entities.last_frame_asset_id must name an asset of the pipeline''s owner'
      USING ERRCODE = '42501';
  END IF;

  IF v_attempt IS NOT NULL
     AND (v_moved OR v_attempt IS DISTINCT FROM v_old_attempt)
     AND (v_attempt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          OR NOT EXISTS (
            SELECT 1 FROM public.assets a
            WHERE a.id = v_attempt::uuid AND a.user_id = v_owner
          )) THEN
    RAISE EXCEPTION 'pipeline_entities.metadata.last_attempted_asset_id must name an asset of the pipeline''s owner'
      USING ERRCODE = '42501';
  END IF;

  -- A scene's asset ids (480, round 3): every key named `asset_id` or ending
  -- in `_asset_id`, at any depth; only a uuid-shaped value names an asset.
  IF v_scene IS NOT NULL
     AND (v_moved OR v_scene IS DISTINCT FROM v_old_scene)
     AND EXISTS (
    SELECT 1
    FROM (
      SELECT CASE WHEN q.v #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  THEN (q.v #>> '{}')::uuid END AS id
      FROM jsonb_path_query(
             v_scene,
             'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "(^|_)asset_id$" && @.value.type() == "string").value'
           ) AS q(v)
      EXCEPT
      SELECT CASE WHEN q.v #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  THEN (q.v #>> '{}')::uuid END
      FROM jsonb_path_query(
             CASE WHEN v_moved THEN NULL ELSE v_old_scene END,
             'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "(^|_)asset_id$" && @.value.type() == "string").value'
           ) AS q(v)
    ) AS changed
    LEFT JOIN public.assets a ON a.id = changed.id AND a.user_id = v_owner
    WHERE changed.id IS NOT NULL AND a.id IS NULL
  ) THEN
    RAISE EXCEPTION 'pipeline_entities.metadata.scene_node_data must name only assets of the pipeline''s owner'
      USING ERRCODE = '42501';
  END IF;

  -- A scene's storage urls (482, decided 2026-10-07): every key named `url`
  -- or ending in `_url` or `_urls`, at any depth; strings and arrays of
  -- strings. Only a url that changed is judged.
  IF v_scene IS NOT NULL
     AND (v_moved OR v_scene IS DISTINCT FROM v_old_scene)
     AND EXISTS (
    SELECT 1
    FROM (
      SELECT u.url FROM public.scene_node_data_urls(v_scene) AS u(url)
      EXCEPT
      SELECT u.url FROM public.scene_node_data_urls(CASE WHEN v_moved THEN NULL ELSE v_old_scene END) AS u(url)
    ) AS changed
    WHERE changed.url IS NOT NULL
      AND public.storage_url_is_foreign(changed.url, v_owner)
  ) THEN
    RAISE EXCEPTION 'pipeline_entities.metadata.scene_node_data must name only storage urls of the pipeline''s owner'
      USING ERRCODE = '42501';
  END IF;

  -- A move carries the entity's variants with it (480, review round).
  IF TG_OP = 'UPDATE' AND NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id
     AND EXISTS (
    SELECT 1 FROM public.pipeline_entity_variants v
    LEFT JOIN public.assets a ON a.id = v.asset_id AND a.user_id = v_owner
    WHERE v.entity_id = NEW.id AND v.asset_id IS NOT NULL AND a.id IS NULL
  ) THEN
    RAISE EXCEPTION 'pipeline_entity_variants.asset_id must name an asset of the pipeline''s owner (the entity moved to another pipeline)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION public.pipeline_entities_asset_owner_check() FROM PUBLIC, anon, authenticated;
