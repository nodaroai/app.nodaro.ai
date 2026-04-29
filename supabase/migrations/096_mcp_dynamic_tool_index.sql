-- Phase 6 v2.0: index for the dynamic-tool factory's per-user query.
--
-- The MCP factory queries a user's published_apps rows (apps + components)
-- ordered by recency to register up to 30 dynamic tools per session
-- (15 components + 15 apps). Most usage is "what did I run last?" so we
-- sort by last_run_at desc, falling back to created_at when never run.
--
-- Schema notes:
-- - published_apps uses creator_id (not owner_user_id) and is_active (not
--   deleted_at). Both are pre-existing.
-- - last_run_at is added by this migration; not yet wired to writes (the
--   factory degrades gracefully via coalesce(last_run_at, created_at)).

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name='published_apps' and column_name='last_run_at'
  ) then
    alter table public.published_apps add column last_run_at timestamptz null;
  end if;
end $$;

create index if not exists published_apps_creator_publish_type_recency_idx
  on public.published_apps (creator_id, publish_type, coalesce(last_run_at, created_at) desc)
  where is_active = true;
