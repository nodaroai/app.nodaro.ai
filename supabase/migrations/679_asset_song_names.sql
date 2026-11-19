-- 679: a song's name on its Library file (decided 2026-11-19).
--
-- A song made with Suno is filed under its storage name, a uuid
-- (`audios/<job id>[-v<n>].wav`), so the Library could neither show it by its
-- name nor find it by one: the name lived only on the job that made it
-- (`output_data.sunoTracks[i].title`, the first take's also as `sunoTitle`).
-- From this release the worker writes it on the file as `metadata.name`, the
-- key extra Library images already carry their name under
-- (`createAssetFromJob`, backend/src/workers/shared.ts), and the Library
-- search reads it beside the file name (`ASSET_SEARCH_COLUMNS`,
-- backend/src/lib/text-search.ts).
--
-- This fills the same name on the files filed before. A file is matched to
-- its take by its address and its owner (a take's `audioUrl` is the stored
-- file's `r2_url`, the existing `(user_id, r2_url)` index), never by its job:
-- a take saved from the canvas (`POST /v1/library/save-generated`) has no
-- `job_id`, and a job's history may be gone. Only an audio file with no name
-- yet, and only a non-blank title, trimmed and kept to 200 characters, the
-- longest name the worker writes. A take two jobs name (never written so)
-- takes the newest job's title.
--
-- `assets_updated_at` (019) stamps `metadata.updated_at` on every update: it
-- is held off for the backfill so the files do not all read as edited now
-- (528 does the same). Idempotent: a second run finds every matched file
-- already named.

ALTER TABLE public.assets DISABLE TRIGGER assets_updated_at;

UPDATE public.assets AS a
SET metadata = COALESCE(a.metadata, '{}'::jsonb) || jsonb_build_object('name', named.name)
FROM (
  SELECT DISTINCT ON (j.user_id, take.track->>'audioUrl')
    j.user_id,
    take.track->>'audioUrl' AS audio_url,
    left(btrim(take.track->>'title'), 200) AS name
  FROM public.jobs AS j
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(j.output_data->'sunoTracks') = 'array' THEN j.output_data->'sunoTracks' ELSE '[]'::jsonb END
  ) AS take(track)
  WHERE j.status = 'completed'
    AND jsonb_typeof(take.track) = 'object'
    AND jsonb_typeof(take.track->'audioUrl') = 'string'
    AND jsonb_typeof(take.track->'title') = 'string'
    AND btrim(take.track->>'title') <> ''
  ORDER BY j.user_id, take.track->>'audioUrl', j.created_at DESC, j.id DESC
) AS named
WHERE a.type = 'audio'
  AND a.user_id = named.user_id
  AND a.r2_url = named.audio_url
  AND (a.metadata->>'name') IS NULL;

ALTER TABLE public.assets ENABLE TRIGGER assets_updated_at;
