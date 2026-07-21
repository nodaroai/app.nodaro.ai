-- GTM attribution substrate: the three facts the platform has never recorded
-- and cannot reconstruct after the fact.
--
--   1. WHICH CHANNEL a user arrived from  -> profiles.first_touch_channel
--   2. WHEN they crossed the storage warn -> profiles.storage_warn_crossed_at
--   3. WHICH CLIENT APP created a job     -> jobs.app_slug
--
-- Plus a registry fix: person.nodaro.ai shipped without a client_apps row, so
-- `inferAppSlugFromSettings` could never match it and its per-user project was
-- never stamped — the exact leak 253 existed to fix, recurring because
-- registration is a manual step no code path enforces.
--
-- The three columns are NULL for existing rows and are NOT backfillable:
-- attribution and threshold crossings are events, and those events already
-- happened unobserved. Only jobs.app_slug has a partial historical source
-- (workflows.app_slug), applied at the bottom.

-- ── 1. Register person.nodaro.ai (the 262 pattern, private-app variant) ──────
-- person marks its per-user PROJECT with `settings.personApp`
-- (person.nodaro.ai/src/lib/person-project.ts:13). Registering the row is the
-- whole fix: projects.ts stamps `projects.app_slug` from
-- `inferAppSlugFromSettings` on both create (:171) and update (:291), so once
-- the registry knows the marker key, stamping starts working with no client
-- change.
--
-- workflows_listed = false: person's documents are private app storage, junk in
-- app.nodaro.ai's own lists.
insert into public.client_apps (slug, name, workflows_listed, settings_key) values
  ('person', 'Person', false, 'personApp')
on conflict (slug) do nothing;

-- Converge a bare row if one was ever hand-created without the marker key.
update public.client_apps set settings_key = 'personApp'
  where slug = 'person' and settings_key is null;

-- NOTE: there is deliberately NO `workflows` backfill for person. Unlike studio
-- / vcp / recast, person creates no workflows at all — every person is a
-- platform Character under its one project, so its gallery is
-- `characters.list({ projectId })` and `workflows.settings ? 'personApp'`
-- would match zero rows. The project backfill below is the whole job.

-- Backfill the per-user Person project — 262's conservative predicate verbatim:
-- never a default project, never one holding another app's rows or real native
-- (node/edge-bearing) workflows. For person the workflow sub-queries are
-- trivially satisfied (it owns none), but they are kept so a project that a
-- user later reused for native work is still never mislabelled.
update public.projects p set app_slug = 'person'
where p.app_slug is null
  and coalesce(p.is_default, false) = false
  and p.settings ? 'personApp'
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

-- ── 2. First-touch marketing attribution ────────────────────────────────────
-- Written ONCE, by POST /v1/profile/attribution, only while NULL.
--
-- Deliberately NOT added to check_profiles_update_allowed's denylist
-- (025_medium_high_fixes.sql): that function guards the credit/role columns and
-- changing its signature means touching the RLS policy protecting billing. The
-- residual risk is a user rewriting their OWN attribution via PostgREST — no
-- economic gain — which does not justify that blast radius. The server route is
-- the intended and only real writer.
alter table public.profiles
  add column if not exists first_touch_channel text,
  add column if not exists first_touch_at timestamptz;

comment on column public.profiles.first_touch_channel is
  'Normalized marketing channel slug (^[a-z0-9][a-z0-9-]{0,39}$) captured on the first public page view and written once after signup. NULL = pre-dates attribution, or arrived without one.';

comment on column public.profiles.first_touch_at is
  'When first_touch_channel was recorded (server clock, at signup-time write — NOT when the visitor first landed).';

-- Activation-by-channel is the whole point of the column; index the grouping key.
create index if not exists idx_profiles_first_touch_channel
  on public.profiles (first_touch_channel)
  where first_touch_channel is not null;

-- ── 3. Storage warning crossing ─────────────────────────────────────────────
-- storage_used_bytes is a mutable counter with no history, so "crossed 85%" is
-- not derivable retroactively. Stamped once by the credit guard, which already
-- computes this exact ratio on every generation request and discarded it.
alter table public.profiles
  add column if not exists storage_warn_crossed_at timestamptz;

comment on column public.profiles.storage_warn_crossed_at is
  'First time this user was observed at >=85% of their storage limit (matches the client meter''s amber threshold). Set once, never cleared. NULL = never observed at the threshold.';

-- ── 4. Job origin ───────────────────────────────────────────────────────────
-- Which client app created this job. NULL = native/app.nodaro.ai, or a route
-- not yet threaded. FK to the registry so an unknown slug fails loudly at insert
-- rather than silently producing an unjoinable value — which is also why job
-- inserts hardcode their own slug instead of reading one from the request body.
alter table public.jobs
  add column if not exists app_slug text references public.client_apps(slug);

comment on column public.jobs.app_slug is
  'Client app that created this job (client_apps.slug). NULL = native app.nodaro.ai or an un-threaded route. Server-set only; never client-supplied.';

create index if not exists idx_jobs_app_slug on public.jobs (app_slug)
  where app_slug is not null;

-- Partial historical backfill: jobs that carry a workflow inherit that
-- workflow's app. Jobs with workflow_id IS NULL (single-node / direct API) are
-- unattributable and stay NULL — accepted, not worked around.
update public.jobs j set app_slug = w.app_slug
from public.workflows w
where j.workflow_id = w.id
  and j.app_slug is null
  and w.app_slug is not null;
