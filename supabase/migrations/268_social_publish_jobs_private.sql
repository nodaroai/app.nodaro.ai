-- Social publish jobs must not be publicly readable.
--
-- jobs.is_public defaults TRUE (migration 011) so completed media jobs feed
-- the public gallery, and the consolidated jobs SELECT policy (migration 032)
-- lets ANY Supabase REST caller read rows with is_public = true AND
-- status = 'completed'. Social publish rows are not gallery media: input_data
-- carries the caption + media URL and output_data the platform post id/url.
-- The insert sites (routes/social-publish.ts + the scheduled worker's
-- ensureJobRow) now set is_public = false explicitly; this flips the rows
-- created before that change.
UPDATE jobs
SET is_public = false
WHERE job_type = 'social-publish'
  AND is_public = true;
