-- Phase 2 OSS readiness: third-party developer app registration

create table public.developer_apps (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text,
  logo_url text,
  homepage_url text,
  allowed_origins text[] not null default array[]::text[]
    check (cardinality(allowed_origins) <= 5),
  redirect_uris text[] not null default array[]::text[]
    check (cardinality(redirect_uris) between 1 and 10),
  client_id text not null unique,
  client_secret_hash text not null,
  scopes_requested text[] not null default array[]::text[],
  status text not null default 'active'
    check (status in ('active', 'suspended', 'pending_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index developer_apps_owner_idx on public.developer_apps(owner_user_id);
create index developer_apps_client_id_idx on public.developer_apps(client_id);
create index developer_apps_status_idx on public.developer_apps(status) where status = 'active';

alter table public.developer_apps enable row level security;

create policy "owner can manage own apps"
  on public.developer_apps for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy "service role has full access"
  on public.developer_apps for all
  using (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- Authorizations (consent grants)
-- ----------------------------------------------------------------------------

create table public.developer_app_authorizations (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.developer_apps(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  scopes_granted text[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (app_id, user_id)
);

create index developer_app_authorizations_user_idx on public.developer_app_authorizations(user_id) where revoked_at is null;
create index developer_app_authorizations_app_idx on public.developer_app_authorizations(app_id) where revoked_at is null;

alter table public.developer_app_authorizations enable row level security;

create policy "users see + revoke own authorizations"
  on public.developer_app_authorizations for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "app owners see who authorized their app"
  on public.developer_app_authorizations for select
  using (exists (
    select 1 from public.developer_apps
    where developer_apps.id = developer_app_authorizations.app_id
      and developer_apps.owner_user_id = auth.uid()
  ));

create policy "service role has full access on authorizations"
  on public.developer_app_authorizations for all
  using (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- Access tokens
-- ----------------------------------------------------------------------------

create table public.developer_app_tokens (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null references public.developer_app_authorizations(id) on delete cascade,
  token_hash text not null unique,
  token_prefix text not null,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index developer_app_tokens_hash_idx on public.developer_app_tokens(token_hash) where revoked_at is null;
create index developer_app_tokens_auth_idx on public.developer_app_tokens(authorization_id);

alter table public.developer_app_tokens enable row level security;

create policy "users see own tokens via authorization"
  on public.developer_app_tokens for select
  using (exists (
    select 1 from public.developer_app_authorizations
    where developer_app_authorizations.id = developer_app_tokens.authorization_id
      and developer_app_authorizations.user_id = auth.uid()
  ));

create policy "service role has full access on tokens"
  on public.developer_app_tokens for all
  using (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger developer_apps_touch_updated_at
  before update on public.developer_apps
  for each row execute function public.touch_updated_at();

create trigger developer_app_authorizations_touch_updated_at
  before update on public.developer_app_authorizations
  for each row execute function public.touch_updated_at();
