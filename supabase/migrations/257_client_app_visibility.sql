-- Client-app visibility, part 2: close the leak migration 253 set up but never
-- enforced end-to-end.
--
-- (Numbered 257: another branch took 256 — nano-banana-2-lite pricing — while
-- this one was in review; the duplicate-prefix guard caught the collision.)
--
-- 253 added `workflows.app_slug` + the `client_apps` registry and backfilled the
-- rows that existed THEN. Three holes remained, all of which let a client app's
-- private storage leak into app.nodaro.ai's own lists (the reported bug: an admin
-- still saw every voice-changer-pro conversion AND the "Voice Changer Pro"
-- project itself):
--
--   1. Rows created SINCE the 253 backfill were never stamped — vcp's create
--      sends no appSlug and the server never inferred one, so every new
--      conversion has app_slug = NULL and lands in the native bucket.
--   2. There was no settings-key -> slug map on the registry, so server-side
--      stamping couldn't be data-driven: vcp writes `settings.vcp` but its slug
--      is `voice-changer-pro` (key != slug); studio writes `settings.studio`
--      (key == slug). 253 hard-coded both predicates; this exposes the mapping.
--   3. `projects` had no origin column at all, so the per-user "Voice Changer
--      Pro" project could not be classified or hidden.
--
-- This migration adds the settings-key map and `projects.app_slug`, then
-- re-backfills both tables. Server-side stamping (workflows.ts / projects.ts)
-- keeps them classified going forward; the dashboard's list fetchers do the
-- hiding. See docs + PR for the full shape.

-- ── 1. settings-key -> slug map on the registry ────────────────────────────
-- The top-level `settings` namespace key each app writes, so stamping can look
-- up "which app does this settings object belong to?" without hard-coding. NULL
-- for an app that has no settings marker (it must then pass `appSlug` explicitly
-- on create to be classified). Mirrors the two predicates 253 hard-coded.
alter table public.client_apps
  add column if not exists settings_key text;

update public.client_apps set settings_key = 'studio'
  where slug = 'studio' and settings_key is null;
update public.client_apps set settings_key = 'vcp'
  where slug = 'voice-changer-pro' and settings_key is null;

comment on column public.client_apps.settings_key is
  'Top-level key this app writes into a workflow/project ''settings'' object (vcp writes ''vcp'', studio writes ''studio''). Used by server-side stamping to infer app_slug from an incoming settings object. NULL = no marker; the app must pass appSlug explicitly.';

-- ── 2. projects.app_slug — same semantics as workflows.app_slug ────────────
-- Which client app owns this project; NULL = native (created in app.nodaro.ai).
alter table public.projects
  add column if not exists app_slug text references public.client_apps(slug);
create index if not exists idx_projects_app_slug on public.projects (app_slug);

comment on column public.projects.app_slug is
  'Client app that created this project; NULL = native (created in app.nodaro.ai). Listed in the dashboard iff NULL or client_apps.workflows_listed is true — same rule as workflows.app_slug.';

-- ── 3. Re-backfill workflows.app_slug for NULL rows ────────────────────────
-- Identical predicates and order to 253, re-run to catch every row created
-- between the 253 backfill and this migration. Idempotent (only touches NULLs).
update public.workflows set app_slug = 'studio'
  where app_slug is null and settings ? 'studio';
update public.workflows set app_slug = 'voice-changer-pro'
  where app_slug is null and settings ? 'vcp';

-- ── 4. Backfill projects.app_slug — CONSERVATIVE, settings-marker-anchored ──
-- A project is stamped with slug S iff ALL of:
--   (a) it self-identifies as app S's dedicated project — `settings ? key(S)`
--       (the VCP project always carries `settings.vcp`, set at creation by the
--       client's ensureVcpProject; studio's carries `settings.studio`). Anchoring
--       on the project's OWN marker — not merely "it contains an S workflow" —
--       is what lets an EMPTY dedicated project (created, never converted) be
--       classified too, which pure content-inference would miss.
--   (b) it is NOT mixed with another app — no workflow whose app_slug is a
--       DIFFERENT non-null slug.
--   (c) it holds no NATIVE workflow with meaningful content — no `app_slug IS
--       NULL` workflow that has at least one node or edge. An empty native
--       placeholder (nodes = [] and edges = []) does not count and does not
--       block: it is the harmless residue of a create that never got its
--       settings write, not something the user built.
--   (d) it is NOT the user's default workspace (`is_default` is NEVER hidden).
--
-- A project that mixes a dedicated app with real native work therefore stays
-- NULL (visible) — we only ever hide a project that is unambiguously one app's
-- private storage. Run AFTER the workflow backfill so (b)/(c) see final slugs.
update public.projects p set app_slug = 'voice-changer-pro'
where p.app_slug is null
  and coalesce(p.is_default, false) = false
  and p.settings ? 'vcp'
  and not exists (
    select 1 from public.workflows w
    where w.project_id = p.id
      and w.app_slug is not null
      and w.app_slug <> 'voice-changer-pro'
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

update public.projects p set app_slug = 'studio'
where p.app_slug is null
  and coalesce(p.is_default, false) = false
  and p.settings ? 'studio'
  and not exists (
    select 1 from public.workflows w
    where w.project_id = p.id
      and w.app_slug is not null
      and w.app_slug <> 'studio'
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
