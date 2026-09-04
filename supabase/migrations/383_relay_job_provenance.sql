-- Relay provenance (Track B / spec 2026-09-04-sai-local-development §D14, D15, D18).
--
-- A community or business instance connected to a Nodaro cloud replays a job
-- there and mirrors the result locally. Two facts about that far job have to
-- survive on the near row, and neither fits an existing column:
--
--   relay_job_id  — the far end's job id. Provenance for support, and the
--                   marker that says "the bytes behind this row were created
--                   by another instance": the near end may drop its row, never
--                   the object (asset-delete.ts / media-delete.ts /
--                   workflow-delete.ts read it before deleteFromR2).
--
--   relay_credits — the far end's `credits` for that job, read from its public
--                   GET /v1/jobs/:id (routes/jobs.ts PUBLIC_JOB_KEYS). NOT
--                   `jobs.credits`: that column means "credits THIS instance
--                   reserved" and every cost audit and the Connected-Instances
--                   rollup read it with that meaning. On a relaying instance
--                   nothing was reserved here, and conflating the two would
--                   make the far end's spend look like the near end's ledger.
--
-- Both NULL on every non-relayed row, in every edition. No backfill.
alter table public.jobs
  add column if not exists relay_job_id  text,
  add column if not exists relay_credits integer;

comment on column public.jobs.relay_job_id  is
  'Far-end job id when this job was relayed to a connected Nodaro cloud. Non-null ⇒ this instance did not create the output object and must never delete it.';
comment on column public.jobs.relay_credits is
  'Far-end reserved credits for the relayed job (its public `credits`). Display units are derived locally via billing.unitRate; never sent over the wire.';

-- Support and settlement both look a relayed row up by the far id.
create index if not exists idx_jobs_relay_job_id
  on public.jobs (relay_job_id) where relay_job_id is not null;
