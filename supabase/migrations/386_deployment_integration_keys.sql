-- Billing integration keys: a machine credential for the billing account's own
-- routes, and nothing else.
-- (Design spec §6.1. Companion TypeScript — the auth-hook branch,
-- the resolver and the mint/list/revoke routes — ships in the same PR.)
--
-- ============================================================================
-- WHY THIS IS A TABLE OF ITS OWN, AND NOT A ROW IN `api_tokens`
-- ============================================================================
-- On a deployment-payer instance (`billing.payerAccount` on the surface
-- profile) ONE designated account pays for every generation, and the routes
-- under `/v1/deployment-billing/` are that account's own surface: they read the
-- real Nodaro balance, mint per-user allowances and start a card payment. Today
-- they accept exactly one credential — the billing account's browser session
-- (`authKind === "jwt"`) — because `require-deployment-payer.ts` refuses every
-- programmatic kind. An integration that allocates quotas from the customer's
-- own back office needs a machine credential for a strict SUBSET of that
-- surface: it must administer and read, and it must never generate and never
-- buy.
--
-- `api_tokens` cannot carry that credential. Every row in that table is
-- resolved by the auth hook (`middleware/auth.ts`, the `ndr_` branch) into a
-- FULL-ACCESS personal token: same user, every route, including the ones that
-- spend the pool. A `kind` column there would make the whole separation depend
-- on every present and future reader of that table remembering a `WHERE` — one
-- forgotten predicate away from handing a relay key the power to allocate. A
-- separate table with a separate bearer prefix (`ndr_bill_<64 hex>`) makes the
-- distinction structural: a row here can never be resolved by the personal-
-- token path, because that path reads a different relation.
--
-- The invariant the pair buys: A CREDENTIAL EITHER SPENDS OR ADMINISTERS,
-- NEVER BOTH. The relay key spends and cannot allocate; this key allocates and
-- reads and cannot spend or buy. A leaked relay key drains the pool at the rate
-- users generate; a leaked key of this class can mis-allocate quotas, which is
-- reversible from the billing page, and can read numbers — it cannot move
-- money. The purchase verb stays browser-only forever, because it is the one
-- verb that turns a leaked credential into a charge on a real card.
--
-- ============================================================================
-- SERVICE ROLE IS THE ONLY READER AND THE ONLY WRITER
-- ============================================================================
-- `token_hash` is the sha256 of a live bearer and `allowed_cidrs` is the source
-- restriction that bearer is checked against. Neither has any business being
-- reachable from a browser under any row, so this table gets RLS ON with NO
-- POLICY AT ALL — the posture 381 takes for `deployment_payer_settings` and 382
-- takes for `deployment_allowance_grants`. The backend's service-role client
-- bypasses RLS, which is the mint route's path and the auth hook's path.
--
-- THE REVOKE IS NOT OPTIONAL AND IT COMES FIRST (the 347 lesson, 347:16-26,
-- restated at 382:133-138): Supabase's default privileges hand anon and
-- authenticated table-level SELECT on every new public table, and a table grant
-- with RLS on still exposes the column list and the row count through error
-- shapes. Table-level, because a column-level revoke under a live table grant
-- does nothing — Postgres checks the table ACL first. There is no matching
-- GRANT afterwards: unlike 382's allowance table, not one column here is a
-- browser's business. The page that lists these keys reads them through a
-- guarded service-role route.
--
-- ============================================================================
-- MAINLINE IS BYTE-IDENTICAL (R2)
-- ============================================================================
-- The auth-hook branch that reads this table is registered under
-- `deploymentPayerActive()`, and the routes that write it are registered under
-- `hasCredits() && deploymentPayerActive()`. With no `billing.payerAccount`
-- nothing in the product names this relation: an `ndr_bill_…` bearer falls
-- through to the personal-token branch and is refused 401 exactly as any other
-- unknown `ndr_` string is today. An empty, unreferenced, service-role-only
-- table is the whole of this migration's effect on a mainline deployment.
--
-- `created_by` carries NO foreign key, deliberately, for 381's reason
-- (`payer_user_id`, 381:52-56): it is always the payer's uuid, asserted in the
-- route at mint time, and a dangling id must degrade to "an audit line naming
-- an account that no longer exists" rather than to a failed DELETE of a
-- profile. `expires_at`, `revoked_at` and the CIDR list are all enforced in the
-- resolver, not by a CHECK: an expired or revoked row must remain readable, so
-- the page can show why a key stopped working.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.deployment_integration_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  -- sha256 hex of the bearer. The bearer itself is returned by the mint route
  -- ONCE and never stored, logged or echoed; UNIQUE so a hash collision or a
  -- double-insert is a constraint violation rather than two live rows.
  token_hash    text NOT NULL UNIQUE,
  -- First 12 characters of the bearer (`ndr_bill_` + 3 hex) — enough for the
  -- page and the audit line to name a key, far too little to reconstruct one.
  token_prefix  text NOT NULL,
  created_by    uuid NOT NULL,                 -- always the payer; asserted at mint
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,                   -- NULL = no expiry; the page recommends 365 d
  last_used_at  timestamptz,                   -- stamped at most once a minute per key
  revoked_at    timestamptz,
  -- NULL = any source. A non-empty list restricts the credential to the
  -- integration's own egress addresses, checked against the forwarded client
  -- IP in the auth hook. `cidr` (not `text`) so a malformed entry is refused by
  -- the database as well as by the mint route.
  allowed_cidrs cidr[]
);

-- The hot path is the auth hook's lookup by hash on every request the key
-- makes; the UNIQUE constraint above already provides that index. This one
-- serves the page's list and the live-key cap at mint.
CREATE INDEX IF NOT EXISTS idx_deployment_integration_keys_created
  ON public.deployment_integration_keys (created_at DESC);

-- RLS ON with NO POLICY, then the table-level REVOKE. Order matters: the
-- revoke is the half that actually closes Supabase's default grant.
ALTER TABLE public.deployment_integration_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deployment_integration_keys FROM anon, authenticated;
