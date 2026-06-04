---
name: building-nodaro-oauth-app
description: Use when implementing OAuth 2.0 against a Nodaro instance — registering a developer app, building the redirect-to-authorize flow, exchanging codes for access tokens server-side, storing/refreshing tokens, handling scope errors. Covers the eleven scopes, the consent screen, RFC 7009 revocation, common errors (invalid_client, invalid_grant, insufficient_scope), and when OAuth is the right choice over API tokens.
---

# Building an OAuth app against Nodaro

Use this skill when:
- You're building an app that operates on behalf of OTHER users (not your own account)
- Users grant your app scoped access via a consent screen
- You need access tokens that expire and can be revoked

If instead you just need server-to-server access to your OWN account, use API tokens (`/v1/api-tokens`) — simpler. See the `using-nodaro-client` skill.

## Overview

Nodaro implements OAuth 2.0 authorization-code flow (RFC 6749) + token revocation (RFC 7009). The flow:

```
Browser → ThirdParty → Nodaro consent → ThirdParty server → Access token → API calls
```

7 steps:
1. User clicks "Connect to Nodaro" on your site
2. You redirect to Nodaro's `/oauth/authorize?...`
3. User signs in (if needed) and clicks "Allow"
4. Nodaro redirects back to your `redirect_uri` with `?code=...&state=...`
5. Your server exchanges the code at `/v1/oauth/token` (with `client_id` + `client_secret`)
6. Nodaro returns `access_token`, `scope`, `expires_in`
7. Your server uses the token in `Authorization: Bearer <token>` headers

## Step 1: Register your app

Visit `<nodaro-instance>/settings/developer-apps` and click "New developer app". Fill in:

- **Name** (1-100 chars) — shown to users on the consent screen
- **Description** (≤500 chars, optional)
- **Homepage URL** (optional) — `https://...` only (or `http://localhost` for dev)
- **Logo URL** (optional)
- **Redirect URIs** (1-10) — exact-match URIs your server will receive the code at. NO wildcards. Be specific (e.g. `https://yourapp.com/oauth/callback` not `https://yourapp.com/`).
- **Allowed origins** (0-5) — bare origins (no path) for CORS. Required if your frontend ever calls Nodaro from a browser.
- **Scopes requested** (1+) — superset of what your app may ever ask for. You can't grant a scope not in this list.

On Save: you get `clientId` (`app_<32hex>`) AND `clientSecret` (`sec_<64hex>`). **The secret is shown ONCE.** Store it securely (encrypted env var, secrets manager).

You can rotate the secret at any time via the "Rotate secret" button — invalidates the old one immediately.

## Step 2: Scope vocabulary

Eleven scopes, all of which exist in your app's `scopes_requested`:

| Scope | What it grants | Routes gated |
|---|---|---|
| `workflows:read` | Read user's workflows | `GET /v1/projects/:projectId/workflows` |
| `workflows:write` | Create / modify workflows | (reserved — no gated routes yet) |
| `workflows:execute` | Run workflows | `POST /v1/workflows/:id/run`; prompt-wizard MCP tools |
| `jobs:read` | Read job status / results | `GET /v1/jobs/:id` |
| `assets:read` | Read user's uploaded assets | (reserved) |
| `assets:write` | Upload assets | (reserved) |
| `credits:read` | See user's credit balance | (reserved) |
| `apps:read` | Read public apps | (reserved) |
| `pipelines:read` | Read Story-to-Video pipelines | `GET /v1/pipelines/*` |
| `pipelines:execute` | Run / branch pipeline stages | `POST /v1/pipelines/:id/branch` and run routes |
| `pipelines:approve` | Approve pipeline stage output | pipeline approval routes |

**Request only what you need.** Users see the requested scopes on the consent screen; over-asking causes drop-off.

## Step 3: Build the authorization redirect

When the user clicks "Connect to Nodaro" on your site:

```
https://nodaro.example.com/oauth/authorize?
  client_id=app_xxxxx&
  redirect_uri=https://yourapp.com/oauth/callback&
  response_type=code&
  scope=workflows:read+workflows:execute&
  state=<RANDOM_CSRF_TOKEN>
```

Required params:
- `client_id` — your app's clientId
- `redirect_uri` — must EXACTLY match one of your registered redirect URIs (byte-for-byte)
- `response_type=code` — only `code` is supported
- `scope` — space- or `+`-separated; must be a subset of your `scopes_requested`
- `state` — opaque CSRF token; verify it matches when the redirect comes back

```typescript
// Example: building the URL
const state = crypto.randomBytes(16).toString("hex")
await db.oauthState.set(state, { userId, expiresAt: Date.now() + 600_000 })

const params = new URLSearchParams({
  client_id: process.env.NODARO_CLIENT_ID!,
  redirect_uri: "https://yourapp.com/oauth/callback",
  response_type: "code",
  scope: "workflows:read workflows:execute",
  state,
})
res.redirect(`https://nodaro.example.com/oauth/authorize?${params}`)
```

## Step 4: Exchange code for token (server-side)

The user clicks "Allow" → Nodaro redirects to:
`https://yourapp.com/oauth/callback?code=ndr_code_<48hex>&state=<your_state>`

**ALWAYS verify state first.** Then exchange on your server (NOT browser — secret would leak):

### Via @nodaro/client SDK

```typescript
import { createClient, StaticTokenAuth } from "@nodaro/client"

const client = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(""),  // /v1/oauth/token is public
})

const tokens = await client.oauth.exchangeCode({
  grant_type: "authorization_code",
  client_id: process.env.NODARO_CLIENT_ID!,
  client_secret: process.env.NODARO_CLIENT_SECRET!,
  code: req.query.code,
  redirect_uri: "https://yourapp.com/oauth/callback",
})
// tokens.access_token  → "ndr_app_<64hex>"
// tokens.token_type    → "Bearer"
// tokens.scope         → "workflows:read workflows:execute"
// tokens.expires_in    → 7776000  (90 days in seconds)
```

### Via curl / fetch

```bash
curl -X POST https://nodaro.example.com/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "authorization_code",
    "client_id": "app_...",
    "client_secret": "sec_...",
    "code": "ndr_code_...",
    "redirect_uri": "https://yourapp.com/oauth/callback"
  }'
```

**Notes:**
- Codes are one-shot (RFC 6749) — second use returns `invalid_grant`
- Code TTL is 10 minutes — exchange immediately
- Response body is snake_case (`access_token`, `token_type`, etc.) per RFC

## Step 5: Use the token

```typescript
const userClient = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(tokens.access_token),
})

const projects = await userClient.projects.list()
// Or:
const exec = await userClient.workflows.run(workflowId, { nodeIds: ["text-1"] })
```

Tokens live 90 days. After expiry: re-prompt the user for consent (re-do `/oauth/authorize`). **No refresh tokens in the MVP** — design choice for simplicity.

## Step 6: Store tokens securely

- **Server-side only.** Never put `access_token` in browser localStorage or readable cookies.
- Encrypt at rest if possible.
- Track which tokens are in use; rotate proactively before 90 days.
- One token per (user, app, granted-consent) — re-granting consent upserts the authorization but mints a new token.

## Step 7: Revocation

When the user disconnects:

```typescript
await client.oauth.revoke(token)
```

Or curl:
```bash
curl -X POST https://nodaro.example.com/v1/oauth/revoke \
  -H "Content-Type: application/json" \
  -d '{ "token": "ndr_app_..." }'
```

Per RFC 7009: always returns 200. Subsequent API calls with the revoked token return 401. Users can also revoke from `/settings/developer-apps` on the Nodaro side.

## Common errors

| Error | Status | Cause | Fix |
|---|---|---|---|
| `invalid_client` | 401 | Wrong `client_id` or `client_secret` | Verify creds. Old secret dead after rotation. |
| `invalid_grant` | 400 | Code expired (>10 min), reused, or `redirect_uri` mismatch | New code; ensure URIs are byte-for-byte identical |
| `invalid_scope` | 400 | Requested scope not in `scopes_requested` | Edit your app to widen `scopes_requested` first |
| `invalid_redirect_uri` | 400 | URI in /authorize doesn't match registered list | Add or fix in app settings |

Plus standard API errors after token use:
- `401 unauthorized` — token expired or revoked → re-auth
- `403 insufficient_scope` (with `missingScope` in body) → request consent for additional scope (re-do authorize with broader scope set; existing authorization will be widened)

The SDK's `ForbiddenError` exposes `missingScope` directly:

```typescript
catch (err) {
  if (err instanceof ForbiddenError && err.missingScope === "workflows:execute") {
    // Re-prompt user for consent including workflows:execute
    redirectToAuthorize([currentScopes, "workflows:execute"])
  }
}
```

## Security checklist

- HTTPS for the entire flow (your app, Nodaro instance, redirect URIs). `http://localhost` only for dev.
- `state` parameter on every authorize, verified on callback.
- `client_secret` server-side only. Rotated periodically.
- Redirect URIs limited to your own domains.
- Scope minimization — request only what you need.
- Token revocation on user logout from your app.
- Catch `ForbiddenError(missingScope)` to drive re-consent gracefully.

## Differences from RFC 6749 / 7009

- PKCE (RFC 7636) supported — public clients may omit `client_secret` and instead send `code_challenge` + `code_challenge_method=S256` at authorize and `code_verifier` at token exchange
- No refresh tokens — re-consent on 90-day expiry
- Token format: `ndr_app_<64hex>` (RFC 6749 doesn't mandate format; type is `Bearer`)
- Code format: `ndr_code_<48hex>`
- Revoke endpoint: per RFC 7009, always returns 200 (no leak about token existence)

## Reference

- Full OAuth flow doc: https://nodaroai.github.io/app.nodaro.ai/oauth-flow.md
- SDK OAuth resource: `packages/client/src/resources/oauth.ts`
- Backend routes: `backend/src/routes/oauth.ts` + `backend/src/routes/developer-apps.ts`
- Scope source-of-truth: `backend/src/lib/scopes.ts`
