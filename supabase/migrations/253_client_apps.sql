-- Registry of client apps built on the Nodaro SDK, and the origin of each
-- workflow row.
--
-- Until now the platform decided what to show in "My Workflows" by reading
-- *studio's private settings namespace* (`settings->studio`) — a leaky
-- abstraction: every new client app would need another hardcoded key, and
-- voice-changer-pro (which writes `settings.vcp`) matched no filter at all, so
-- its per-conversion workflows polluted every user's workflow list.
--
-- Two facts were conflated; this migration separates them:
--   1. WHO created the workflow  -> workflows.app_slug (NULL = native).
--   2. Are that app's workflows user-facing -> a property of the APP, held here,
--      so changing an app's mind is one UPDATE, not a rewrite of a million rows.
--
-- Visibility rule (implemented in exactly one place, the dashboard workflow
-- list): a workflow is listed iff `app_slug IS NULL` OR its app has
-- `workflows_listed = true`.

create table if not exists public.client_apps (
  slug text primary key,
  name text not null,
  -- Are this app's workflows first-class objects the user can open in
  -- app.nodaro.ai (studio), or private app storage that would be junk
  -- there (voice-changer-pro)? Defaults to HIDDEN: an unregistered or
  -- misconfigured app must not pollute everyone's workflow list.
  workflows_listed boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.client_apps (slug, name, workflows_listed) values
  ('studio', 'Studio', true),
  ('voice-changer-pro', 'Voice Changer Pro', false)
on conflict (slug) do nothing;

-- Which client app created this workflow. NULL = native.
alter table public.workflows
  add column if not exists app_slug text references public.client_apps(slug);
create index if not exists idx_workflows_app_slug on public.workflows (app_slug);

-- Backfill from the settings namespaces the platform has been reading until now,
-- so existing rows are classified without touching a single client.
update public.workflows set app_slug = 'studio'
  where app_slug is null and settings ? 'studio';
update public.workflows set app_slug = 'voice-changer-pro'
  where app_slug is null and settings ? 'vcp';

alter table public.client_apps enable row level security;

-- Any authenticated user can read: the dashboard needs the listed set to build
-- its workflow-list filter on every load. The table holds no secrets — just
-- which apps exist and whether their workflows are user-facing.
create policy "client_apps_read"
  on public.client_apps
  for select
  to authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policies — writes go through the service-role backend
-- route gated by `requireAdmin` middleware, matching node_defaults (091) and
-- admin-llm-models.ts.

comment on table public.client_apps is
  'Registry of client apps built on the Nodaro SDK. workflows_listed decides whether an app''s workflows appear in the user''s app.nodaro.ai workflow list. Fails closed: an unregistered app_slug is hidden.';

comment on column public.workflows.app_slug is
  'Client app that created this workflow; NULL = native (created in app.nodaro.ai). Listed in the dashboard iff NULL or client_apps.workflows_listed is true.';
