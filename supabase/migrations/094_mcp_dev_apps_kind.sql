-- Phase 6 v1.0: tag developer_apps with their registration kind
--
-- "user"            — manually registered via dashboard (existing apps; default)
-- "dynamic_mcp"     — registered via RFC 7591 Dynamic Client Registration (DCR);
--                     no human owner until OAuth consent step assigns one
-- "first_party_mcp" — operator-seeded built-in app (reserved; not used in v1)

alter table public.developer_apps
  add column kind text not null default 'user'
  check (kind in ('user', 'first_party_mcp', 'dynamic_mcp'));

-- DCR rows have no human owner until OAuth completes; relax the NOT NULL.
-- FK constraint on owner_user_id → profiles(id) is preserved (still ON DELETE CASCADE),
-- just nullable now.
alter table public.developer_apps
  alter column owner_user_id drop not null;

-- Partial index — used by the daily GC job that deletes stale dynamic registrations
-- (kind='dynamic_mcp' AND created_at < now() - 24h AND no developer_app_authorizations row).
create index developer_apps_kind_dynamic_idx
  on public.developer_apps (created_at)
  where kind = 'dynamic_mcp';
