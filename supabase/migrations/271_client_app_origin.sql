-- Client-app origin tracking, part two: register person.nodaro.ai, and record
-- which client app created a job.
--
-- Split from 270 deliberately. 270 is launch-critical and trivially safe (three
-- ADD COLUMNs, no backfill). This one carries a backfill and — via jobs.app_slug
-- — a CROSS-REPO DEPLOY ORDERING CONSTRAINT that can take VCP down if violated.
-- Keeping them apart means the attribution columns can never be blocked by, or
-- broken with, this.
--
-- ⚠️ DEPLOY ORDER — READ BEFORE SHIPPING ANY CLOUD-PLUGINS BUILD ⚠️
-- @nodaroai/cloud-plugins is an npm package loaded in-process and pinned by the
-- CLOUD_PLUGINS_VERSION build-arg on the platform's Railway service. Merging a
-- plugins PR deploys NOTHING; publishing the package and bumping that pin is
-- the deploy. If a plugins build that writes `jobs.app_slug` goes live before
-- THIS migration is applied to that environment, every VCP and Recast job
-- insert fails with PostgREST `PGRST204: Could not find the 'app_slug' column`
-- — a total outage of both apps, not a degradation.
-- Apply this migration first. Verify with:
--   select column_name from information_schema.columns
--    where table_name = 'jobs' and column_name = 'app_slug';

-- ── 1. Register person.nodaro.ai ────────────────────────────────────────────
-- person shipped without a client_apps row, so `inferAppSlugFromSettings` could
-- never match it and its per-user project was never stamped — the leak 253
-- exists to prevent, recurring because registration is a manual step no code
-- path enforces.
--
-- person marks its per-user PROJECT with `settings.personApp`
-- (person.nodaro.ai/src/lib/person-project.ts:13). Registering the row IS the
-- whole fix: routes/projects.ts stamps `projects.app_slug` from
-- `inferAppSlugFromSettings` on both create (:171) and update (:291), so once
-- the registry knows the marker key, stamping starts working with no client
-- change and no client deploy.
--
-- workflows_listed = false: person's rows are private app storage, junk in
-- app.nodaro.ai's own lists.
insert into public.client_apps (slug, name, workflows_listed, settings_key) values
  ('person', 'Person', false, 'personApp')
on conflict (slug) do nothing;

-- Converge a bare row if one was ever hand-created without the marker key.
update public.client_apps set settings_key = 'personApp'
  where slug = 'person' and settings_key is null;

-- NOTE: there is deliberately NO `workflows` backfill for person, unlike 253
-- (studio/vcp) and 262 (recast). person creates no workflows AT ALL — every
-- person is a platform Character under its one project, so the gallery is
-- `characters.list({ projectId })` and there is no app database
-- (person-project.ts:5-8). `workflows.settings ? 'personApp'` would match zero
-- rows forever. The project backfill below is the entire job.
update public.projects p set app_slug = 'person'
where p.app_slug is null
  and coalesce(p.is_default, false) = false
  and p.settings ? 'personApp'
  -- 262's conservative predicate: never relabel a project that also holds
  -- another app's rows, or real native (node/edge-bearing) workflows. For
  -- person these are trivially satisfied today (it owns no workflows), but they
  -- are kept so a project a user later reused for native work stays native.
  and not exists (
    select 1 from public.workflows w
    where w.project_id = p.id
      and w.app_slug is not null
      and w.app_slug <> 'person'
  )
  and not exists (
    select 1 from public.workflows w
    where w.project_id = p.id
      and w.app_slug is null
      and (
        (jsonb_typeof(w.nodes) = 'array' and jsonb_array_length(w.nodes) > 0)
        or (jsonb_typeof(w.edges) = 'array' and jsonb_array_length(w.edges) > 0)
      )
  );

-- ── 2. Job origin ───────────────────────────────────────────────────────────
-- Which client app created this job. NULL = native app.nodaro.ai, or a route
-- not yet threaded. FK to the registry so an unknown slug fails loudly at insert
-- rather than silently producing an unjoinable value — which is also exactly why
-- job inserts hardcode their own slug server-side instead of reading one from
-- the request body.
alter table public.jobs
  add column if not exists app_slug text references public.client_apps(slug);

comment on column public.jobs.app_slug is
  'Client app that created this job (client_apps.slug). NULL = native app.nodaro.ai or an un-threaded route. Server-set only, never client-supplied: the FK means a bogus value would fail the insert.';

create index if not exists idx_jobs_app_slug on public.jobs (app_slug)
  where app_slug is not null;

-- NOTE: no historical backfill for jobs.app_slug, by choice.
-- The obvious one — `update jobs set app_slug = w.app_slug from workflows w
-- where j.workflow_id = w.id` — is an UNBOUNDED full-table UPDATE on the
-- largest table in the system, rewriting every workflow-bearing row in a single
-- transaction under a migration statement timeout, during launch week. The GTM
-- question this column serves is forward-looking ("which app is generating load
-- from here on"), and historical VCP attribution is already available without
-- it via `usage_logs.action = 'voice-changer-pro'`. If a backfill is ever
-- genuinely wanted, run it OUT of band, batched by created_at.
