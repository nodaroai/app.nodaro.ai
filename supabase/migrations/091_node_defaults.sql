-- Admin-controlled default model/provider per AI node type.
-- Three-layer default resolution (factory <- admin DB <- user localStorage)
-- runs only at addNode() in the editor; existing workflows are never mutated.

create table public.node_defaults (
  node_type      text primary key,
  provider       text not null,
  quality_level  text check (quality_level in ('low','mid','high')),
  aspect_ratio   text check (aspect_ratio in ('auto','1:1','4:3','3:4','16:9','9:16')),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id)
);

alter table public.node_defaults enable row level security;

-- Any authenticated user can read (the editor needs this on every workflow load).
-- On community edition the table is naturally empty (no admin to write).
create policy "node_defaults_read"
  on public.node_defaults
  for select
  to authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policies — writes go through the service-role
-- backend route gated by `requireAdmin` middleware, matching admin-llm-models.ts.

comment on table public.node_defaults is
  'Admin-controlled default provider/quality/aspect-ratio per AI node type. Applied at node creation; never mutates existing nodes.';
