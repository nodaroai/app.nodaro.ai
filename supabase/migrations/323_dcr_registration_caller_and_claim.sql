-- Dynamic client registration (RFC 7591) — two repairs for community
-- instances (#708, release check 10, 2026-08-16).
--
-- 1. `registered_ip_hash`: who registered (sha256 of the caller's address).
--    The open-registration cap for `kind = 'community_instance'` now counts
--    per caller instead of per (client_name + redirect_uris): every default
--    self-hosted install registers as "Nodaro instance (localhost:3000)" with
--    the same callback URL, so the name-keyed cap was ONE bucket shared by
--    every install in the world — five Connect clicks in a day anywhere and
--    the sixth got 429.
--
-- 2. Backfill `owner_user_id` for community instances whose consent DID
--    complete. The consent step (routes/oauth.ts) claimed the row only for
--    `dynamic_mcp`, so every community registration ever made still reads as
--    "unconsumed" to the cap. The claim now covers both kinds going forward;
--    this repairs history so completed connections stop counting.
--
-- Additive; safe to re-run.

alter table public.developer_apps
  add column if not exists registered_ip_hash text;

-- The cap query: kind + caller + open + recent.
create index if not exists developer_apps_dcr_open_by_caller_idx
  on public.developer_apps (kind, registered_ip_hash, created_at)
  where owner_user_id is null;

-- A registration is "consumed" once someone consented to it. Community rows
-- were never marked; take the first consenting user.
update public.developer_apps a
set owner_user_id = z.user_id
from (
  select distinct on (app_id) app_id, user_id
  from public.developer_app_authorizations
  order by app_id, created_at asc
) z
where a.id = z.app_id
  and a.kind = 'community_instance'
  and a.owner_user_id is null;
