-- Register recast.nodaro.ai in the client-apps registry — the PRIVATE-app
-- pattern (like voice-changer-pro), not the listed one (studio): its per-user
-- "Recast" project and workflow-per-recast documents are the app's private
-- storage and must not appear in app.nodaro.ai's own lists.
--
-- Data-driven per 253/257: one registry row (slug + settings_key +
-- workflows_listed=false) is the whole code path — server-side stamping infers
-- app_slug from the `settings.recast` marker the client already writes, and the
-- dashboard's list fetchers hide unlisted apps. The app shipped before this row
-- existed, so the backfills below (copied verbatim from 257's re-backfill, same
-- idempotent NULLs-only predicates) reclassify the rows created in between.

insert into public.client_apps (slug, name, workflows_listed, settings_key) values
  ('recast', 'Recast', false, 'recast')
on conflict (slug) do nothing;

-- If a bare row was ever hand-created without the marker key, converge it.
update public.client_apps set settings_key = 'recast'
  where slug = 'recast' and settings_key is null;

-- ── Backfill workflows created before registration (idempotent, NULLs only) ──
update public.workflows set app_slug = 'recast'
  where app_slug is null and settings ? 'recast';

-- ── Backfill the per-user "Recast" project — 257's conservative predicate ──
-- Only hide a project that is unambiguously this app's private storage: never
-- a default project, never one holding another app's rows or real native
-- (node/edge-bearing) workflows. Run AFTER the workflow backfill above.
update public.projects p set app_slug = 'recast'
where p.app_slug is null
  and coalesce(p.is_default, false) = false
  and p.settings ? 'recast'
  and not exists (
    select 1 from public.workflows w
    where w.project_id = p.id
      and w.app_slug is not null
      and w.app_slug <> 'recast'
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
