# External SSO

Let a trusted external identity provider (IdP) sign users into your Nodaro
install. Two integration styles are supported, and you should prefer the first
one that your IdP can speak:

1. **Supabase-native OIDC / SAML** (`kind: "oidc"` / `"saml"`) — when your IdP
   speaks standard OpenID Connect or SAML, wire it into the install's Supabase
   Auth and let the browser do a normal `signInWithSSO` / `signInWithOAuth`
   redirect. This is the preferred path: the assertion is verified by Supabase.
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
    "id": "acme-okta",
    "label": "Acme (Okta)",
    "kind": "saml",
    "domain": "acme.com"
  }
]
```

### Fields

| Field | Applies to | Meaning |
|-------|-----------|---------|
| `id` | all | URL-safe slug (`[a-z0-9_-]`, ≤ 63 chars). Used in the route path `/v1/sso/:id` and stored on the user as `user_metadata.sso`. Must be unique. |
| `label` | all | Human name shown on the login button. |
| `kind` | all | `"assertion"`, `"oidc"`, or `"saml"`. |
| `secret` | assertion (**required**) | The HS256 HMAC key used to verify the assertion signature. Use a **dedicated** secret — never the IdP's own session-signing secret, so a Nodaro compromise cannot forge IdP sessions. Minimum 16 characters. |
| `audience` | assertion (**required**) | The value the assertion's `aud` claim must equal. |
| `claimMap` | assertion (optional) | Which JWT claims carry the email / verified-flag / subject. Defaults to `{ "email": "email", "emailVerified": "email_verified", "subject": "sub" }`. |
| `initiateUrl` | assertion (optional) | Where `GET /v1/sso/:provider` redirects when it is hit **without** an assertion — i.e. the login button sends the user here, the IdP authenticates them, and redirects back with `?assertion=…`. |
| `maxLifetimeSeconds` | assertion (optional) | Server-enforced cap on the assertion's lifetime (`exp − iat`). Default `300` (5 minutes), max `3600`. An assertion that claims a longer lifetime is rejected even if the IdP minted it. |
| `domain` | oidc / saml (**one of `domain`/`supabaseProvider` required**) | The Supabase-native SSO domain passed to `signInWithSSO`. |
| `supabaseProvider` | oidc (optional) | The Supabase OAuth provider name passed to `signInWithOAuth`. |

## The assertion contract (`kind: "assertion"`)

Your IdP mints a JWT and redirects the browser to
`GET /v1/sso/:provider?assertion=<jwt>`. Nodaro accepts it only when **all** of
the following hold:

- **Algorithm** is `HS256`, signed with the provider's `secret`.
- **`aud`** equals the provider's `audience`.
- **`exp`** is present and not in the past (a small clock-skew tolerance
  applies), and the lifetime `exp − iat` does not exceed `maxLifetimeSeconds`.
- **`jti`** is present and unique. Each `jti` is redeemable **once** — a replayed
  assertion is rejected (the `jti` is cached until the assertion's own validity
  window has fully elapsed).
- **`email`** (per `claimMap`) is present.
- **`email_verified`** (per `claimMap`) is `true` for the account to be
  provisioned or linked (see below). A missing flag is treated as *not*
  verified.

A failing assertion returns `401`; the endpoint is per-IP rate limited.

## Account-linking rules

When an assertion verifies, Nodaro resolves it to a Supabase user under rules
designed so that **an assertion can never take over a pre-existing account that
merely shares the email address**:

| Situation | Result |
|-----------|--------|
| No account exists for the email, and the assertion says the email is **verified** | **Provision** a new user; stamp `user_metadata.sso = <provider id>` (and `sso_subject`). |
| No account exists, email **not** verified | **Rejected** (`403`) — an unverified claim may not squat a real address. |
| An account exists and is **already linked** to this provider (`user_metadata.sso` matches) | **Linked** — signed in. |
| An account exists and is **already linked to a *different* provider** | **Rejected** (`403`, `account_linked_other_provider`) — an account federated to another IdP is never re-stamped, even with `EXTERNAL_SSO_LINK_EXISTING=true`. |
| An **unfederated local account** exists (no `user_metadata.sso`), and `EXTERNAL_SSO_LINK_EXISTING=true` **and** the email is verified | **Linked** — the account is stamped with this provider and signed in. |
| An **unfederated local account** exists, and the flag is `false` (the default) or the email is unverified | **Rejected** (`403`, `account_exists`). |

`EXTERNAL_SSO_LINK_EXISTING` defaults to `false` — the takeover-safe setting.
Turn it on only when you trust the configured IdPs' verified-email claims enough
to attach them to accounts that already exist.

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
                          └─▶  /projects (or a same-origin ?next path)
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
