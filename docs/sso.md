# External SSO

Let a trusted external identity provider (IdP) sign users into your Nodaro
install. Two integration styles are supported:

1. **Supabase-native OIDC / SAML** (`kind: "oidc"` / `"saml"`) — when your IdP
   speaks standard OpenID Connect or SAML, wire it into the install's Supabase
   Auth and let the browser do a normal `signInWithSSO` / `signInWithOAuth`
   redirect. The assertion is verified by Supabase. **Today this path is only
   partly wired**: the login page passes the provider `id` straight to
   `signInWithSSO` (as the SAML domain) / `signInWithOAuth` (as the provider
   name) — see the `domain` / `supabaseProvider` rows below. The bespoke
   exchange in (2) is the path exercised end-to-end.
2. **Bespoke assertion exchange** (`kind: "assertion"`) — for issuers that do
   **not** speak OIDC/SAML (for example an embedding host such as LibreChat that
   can only mint a short-lived signed token). The IdP signs a JWT "assertion";
   Nodaro verifies it and exchanges it for an ordinary Supabase session.

SSO is **off by default**. With `EXTERNAL_SSO_PROVIDERS` unset, the login page
shows no SSO button, `GET /v1/sso/providers` returns `{ "providers": [] }`, and
`GET /v1/sso/:provider` returns `404`. Configuring at least one provider turns
it on.

The account you end up signed in as is an **ordinary Supabase user** — there is
no bespoke credential mode. SSO is only a way to *start* a session.

## Configuring providers

Set `EXTERNAL_SSO_PROVIDERS` to a JSON array, either inline or as
`@/path/to/providers.json` (a leading `@` reads the file at that path). A
malformed value **fails the boot loudly** — a typo in a secret-bearing entry
must never silently drop a provider (which would look like SSO mysteriously
404ing) or half-configure auth.

```json
[
  {
    "id": "librechat",
    "label": "LibreChat",
    "kind": "assertion",
    "secret": "a-dedicated-32+char-hmac-key-not-the-idp-session-secret",
    "audience": "nodaro",
    "claimMap": { "email": "email", "emailVerified": "email_verified", "subject": "sub" },
    "initiateUrl": "https://chat.example.com/oauth/nodaro",
    "maxLifetimeSeconds": 300
  },
  {
    "id": "keycloak",
    "label": "Acme (Keycloak)",
    "kind": "oidc",
    "supabaseProvider": "keycloak"
  }
]
```

(For a native provider the `id` is what reaches Supabase — it must be the OAuth
provider name configured in the install's Supabase Auth.)

### Fields

| Field | Applies to | Meaning |
|-------|-----------|---------|
| `id` | all | URL-safe slug: `[a-z0-9]` first, then `[a-z0-9_-]`, 1–63 chars, no dots (`^[a-z0-9][a-z0-9_-]{0,62}$`). Used in the route path `/v1/sso/:id` and stored on the user as `user_metadata.sso` and, service-role-only, `app_metadata.sso` (the copy the server trusts). Must be unique. |
| `label` | all | Human name for the provider. Shown on the login button only when **two or more** providers are configured and the surface profile sets no `auth.ssoLabel`; with a single provider the button reads `Single sign-on` (or the profile's `auth.ssoLabel`). |
| `kind` | all | `"assertion"`, `"oidc"`, or `"saml"`. |
| `secret` | assertion (**required**) | The HS256 HMAC key used to verify the assertion signature. Use a **dedicated** secret — never the IdP's own session-signing secret, so a Nodaro compromise cannot forge IdP sessions. Minimum 16 characters. |
| `audience` | assertion (**required**) | The value the assertion's `aud` claim must equal. |
| `claimMap` | assertion (optional) | Which JWT claims carry the email / verified-flag / subject. Defaults to `{ "email": "email", "emailVerified": "email_verified", "subject": "sub" }`. |
| `initiateUrl` | assertion (optional) | An absolute URL. Where `GET /v1/sso/:provider` redirects (`302`) when it is hit **without** an assertion — i.e. the login button sends the user here, the IdP authenticates them, and redirects back with `?assertion=…`. Nothing else is forwarded on that hop: if you want a post-login destination, your IdP must append `&next=<same-origin path>` on the way back. Without `initiateUrl`, a button hit answers `400 no_assertion`. |
| `initiateUrlByHost` | assertion (optional) | A map from a **bare lower-case hostname** (no port) to an absolute URL: when the button hit arrives on that host, the redirect goes there instead of `initiateUrl`, which stays the default for every other host. For a deployment that answers on more than one hostname and whose IdP must be reached on a matching host. Keys are validated at boot — a mis-cased or ported key aborts startup rather than silently falling back. The map is never published by `GET /v1/sso/providers`. The provider `id`, `secret` and `audience` do not change per host, so account linking is unaffected by which host a user arrived on. |
| `maxLifetimeSeconds` | assertion (optional) | Server-enforced cap on the assertion's lifetime (`exp − iat`). Default `300` (5 minutes), max `3600`. An assertion that claims a longer lifetime is rejected even if the IdP minted it. |
| `domain` | oidc / saml (**one of `domain`/`supabaseProvider` required**) | Reserved. Validated at boot but **not yet consumed**: `GET /v1/sso/providers` publishes only `id`, `label` and `kind`, and the login page passes the provider **`id`** to `signInWithSSO` as the domain. Because `id` is a slug (no `.`), a Supabase-native SAML domain such as `acme.com` cannot currently be expressed — treat `kind: "saml"` as not wired end-to-end yet. |
| `supabaseProvider` | oidc (optional) | Reserved. Validated but **not yet consumed**: the login page passes the provider **`id`** as the `provider` argument to `signInWithOAuth`, so for `kind: "oidc"` the `id` must itself be a Supabase OAuth provider name (for example `keycloak` or `azure`). |

## The assertion contract (`kind: "assertion"`)

Your IdP mints a JWT and redirects the browser to
`GET /v1/sso/:provider?assertion=<jwt>`. Nodaro accepts it only when **all** of
the following hold:

- **Algorithm** is `HS256`, signed with the provider's `secret`.
- **`aud`** equals the provider's `audience`.
- **`exp`** is present and not in the past (a small clock-skew tolerance
  applies — 5 seconds), and the lifetime `exp − iat` does not exceed
  `maxLifetimeSeconds`. The lifetime is measured against Nodaro's clock: an
  `iat` more than 5 s in the future is clamped (and a missing `iat` counts as
  now), so a future-dated `iat` cannot shrink the measured lifetime.
- **`jti`** is present and unique. Each `jti` is redeemable **once** — a replayed
  assertion is rejected (the `jti` is cached until the assertion's own validity
  window has fully elapsed).
- **`email`** (per `claimMap`) is present.
- **`email_verified`** (per `claimMap`) is `true` for the account to be
  provisioned or linked (see below). A missing flag is treated as *not*
  verified.

A failing assertion returns `401` (`invalid_signature` / `invalid_claims` /
`expired` / `too_long_lived` / `missing_jti` / `missing_email`, or
`assertion_replayed`); the endpoint is per-IP rate limited to 20 requests per
60 seconds (`429 rate_limit_exceeded`, with a `Retry-After` header).

## Account-linking rules

When an assertion verifies, Nodaro resolves it to a Supabase user under rules
designed so that **an assertion can never take over a pre-existing account that
merely shares the email address**:

| Situation | Result |
|-----------|--------|
| No account exists for the email, and the assertion says the email is **verified** | **Provision** a new user; stamp `user_metadata.sso = <provider id>` (and `sso_subject`), plus the service-role-only `app_metadata` copy the server trusts. Exception: a platform-operator address on a deployment with a billing account is not provisioned (last row). |
| No account exists, email **not** verified | **Rejected** (`403`, `email_unverified`) — an unverified claim may not squat a real address. |
| An account exists and is **already linked** to this provider (`user_metadata.sso` matches) | **Linked** — signed in. The deployment's **billing account** is the one exception: it re-checks the verified-email claim and the subject on *every* assertion (next row). |
| The **billing account** is already linked to this provider, and the assertion's subject is **not** the linked one (or the account carries no trusted `app_metadata.sso_subject`, or the email is not verified) | **Rejected** (`403`, `account_linked_other_subject` / `email_unverified`) — for the account that holds the deployment's credits the rules hold on every sign-in, not only the first. |
| An account exists and is **already linked to a *different* provider** | **Rejected** (`403`, `account_linked_other_provider`) — an account federated to another IdP is never re-stamped, even with `EXTERNAL_SSO_LINK_EXISTING=true`. |
| The account is the deployment's **billing account** (`billing.payerAccount`), not yet federated, and the email is **verified** | **Linked** — whatever `EXTERNAL_SSO_LINK_EXISTING` is set to, unless its address is also on the platform-operator allowlist (last row, which is checked first). See [The billing account](#the-billing-account) below. |
| The account is the deployment's **billing account** and the email is **not** verified | **Rejected** (`403`, `email_unverified`) — an unverified claim never takes the account that holds the deployment's credits. |
| An **unfederated local account** exists (no `user_metadata.sso`), and `EXTERNAL_SSO_LINK_EXISTING=true` **and** the email is verified | **Linked** — the account is stamped with this provider and signed in. |
| An **unfederated local account** exists, and the flag is `false` (the default) or the email is unverified | **Rejected** (`403`, `account_exists`). |
| The address is on the platform-operator allowlist (`PLATFORM_OPERATOR_EMAILS`, or `PLATFORM_OWNER_EMAIL` when that is unset), the deployment names a `billing.payerAccount`, and the address is **not already linked** to this provider — whether it has an account yet or not | **Rejected** (`403`, `account_exists`) — see below. This rule is checked **before** the billing-account rows: a billing account whose address is also on the allowlist is refused, not linked. |

Two refusals carry no detail on purpose. `account_exists` and `email_unverified`
use the **same wording for every account**, so the login form cannot be used to
probe which address is the deployment's billing account or its operator; which
account was targeted is written to the server log instead. `account_exists` is
also the answer when the address cannot be resolved to exactly one account —
more than one `profiles` row carries it, the lookup fails, or the matched
account's own auth email differs — and when provisioning loses a race (that one
carries the message "Could not provision an account for this email.").

The **platform operator's** address is not newly federated on a deployment that
has a billing account. Those credit-grant routes require an account that is
*not* federated, so adopting the operator's address would not open them — it
would close them permanently, for the operator's own password session too. An
operator account that is **already** linked to the provider is unaffected and
keeps signing in: the rule prevents that state, it does not punish it.

`EXTERNAL_SSO_LINK_EXISTING` defaults to `false` — the takeover-safe setting.
Only `true` or `1` (case-insensitive) turns it on; any other value is `false`.
Turn it on only when you trust the configured IdPs' verified-email claims enough
to attach them to accounts that already exist.

### The billing account

On a deployment that names a `billing.payerAccount` (see
[deployment.md](./deployment.md#surface-profile-nodaro_surface_profile)), that
one account is an **identity of the deployment's own provider** like any other
user of the instance:

- It **links on its first verified sign-in**, without
  `EXTERNAL_SSO_LINK_EXISTING` — the flag is instance-wide and cannot be turned
  on for a single account, and the pool this account holds is the deployment's
  own money. (One address never links: an account whose email is also on the
  platform-operator allowlist is refused `account_exists` — that rule is
  checked first, see the table.) An **unverified** assertion for it is refused
  (`403 email_unverified`); an assertion from a *different* provider than the
  one it is already linked to is refused as for anybody else
  (`403 account_linked_other_provider`).
- Those two conditions are re-checked on **every** later assertion, not only
  the one that links — together with the assertion's **subject**, which must
  stay the identity the account was linked to (`403
  account_linked_other_subject` otherwise). For every other account, an
  assertion carrying the marker signs in on the marker alone. The asymmetry is
  deliberate: this is the one account where a single unverified or
  re-pointed claim would reach the deployment's money. If the provider's
  subject ever legitimately changes, the password door below is how the billing
  account gets back **in** — but nothing in the product re-points the stored
  subject (the admin SSO route refuses this account), so its SSO sign-in keeps
  failing `account_linked_other_subject` until the platform operator rewrites
  `app_metadata.sso_subject` (and `user_metadata.sso_subject`) on the account
  with the service-role admin API.
- It also keeps a **platform-issued password** as a break-glass door, for the
  day the provider cannot assert it. On a deployment whose profile allows only
  `sso`, that form is reachable at `/login?billing=1` and nothing links to it;
  the server admits exactly the one account, and any other identity signing in
  through it is refused on its first API call.
- It **cannot be de-provisioned** through the admin SSO route: banning or
  deleting it is refused with `403 payer_account_protected`, so an admin role
  handed out by the deployment's own IdP cannot lock the instance out of its
  own credits. Every other federated account stays de-provisionable.
- Platform-side **credit grants are unaffected**: those routes require an
  account on `PLATFORM_OPERATOR_EMAILS` that is *not* federated, so an identity
  the deployment's provider asserts can never mint credits.

## The flow

```
Login page  ──click──▶  GET /v1/sso/:provider           (no assertion)
                          └─302─▶  IdP (provider.initiateUrl)
IdP  ──authenticates, redirects back──▶  GET /v1/sso/:provider?assertion=<jwt>
                          ├─ verify signature / aud / exp / lifetime / jti
                          ├─ reject replays (jti seen before)
                          ├─ apply account-linking rules
                          └─302─▶  /sso?sso_token=<one-time token>
Browser  ──/sso landing exchanges the one-time token──▶  Supabase session
                          └─▶  /projects (or a same-origin ?next path — present only
                               if the IdP appended &next= when it redirected back;
                               the login page's own ?redirect= is not forwarded
                               through the SSO hop)
```

The login page shows an SSO button only when the deployment's surface profile
advertises the `sso` auth method **and** at least one provider is configured
(the page probes `GET /v1/sso/providers`).

## Security notes

- **Dedicated secret.** The `secret` is a verification key for Nodaro only,
  distinct from the IdP's own session secret.
- **Single-use assertions.** The `jti` replay cache rejects a re-submitted
  assertion; the server-enforced max-lifetime keeps the replay window short.
- **Open-redirect guard.** The `next` parameter is honoured only when it is a
  same-origin *relative* path (starts with `/`, not `//`); anything else falls
  back to `/projects`.
- **No secret ever leaves the server.** `GET /v1/sso/providers` returns only
  `id`, `label`, and `kind` — never the `secret`. The assertion and the minted
  one-time token are redacted from request logs.
- **Rate limited.** The exchange endpoint is per-IP rate limited.
- **Ordinary session.** After exchange the user is a normal Supabase user; SSO
  adds no special credential mode.

## API endpoints

See [API Integration](./api-integration.md#external-sso) for the request/response
detail of `GET /v1/sso/providers` and `GET /v1/sso/:provider`.
