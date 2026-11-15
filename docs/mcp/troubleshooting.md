# MCP Troubleshooting

## "Connected" but no tools appear

Likely cause: the granted scopes don't match what tools require. Re-authorize and
make sure all scopes are granted.

## A tool is missing, or answers `node_not_available` {#not-offered}

The deployment you are connected to does not offer what that tool needs — a
node, a feature, Studio, link imports or a model family — to your account, so
the tool is left out of the list ([What a deployment offers](tools.md#what-a-deployment-offers)).
A client that kept an older list may still call it; the call is refused with
the reason (`403 node_not_available`, `model_not_available`,
`link_imports_disabled` or `world_not_available`) before anything runs or is
charged. Refresh the client's tools, or ask the deployment's admin to offer it.

## A call answers `link_imports_disabled` {#link-imports-disabled}

```
Request failed (403 link_imports_disabled): Importing media from a link to another site is turned off on this deployment. Upload the file instead.
```

The deployment you are connected to does not import media from other sites
(`imports.links: false`), and one of the call's arguments is a link to
something that is not a file of the deployment's own storage: a picture, clip
or sound URL, a reference, a page, or a link inside an app's inputs, a plan or
a workflow's nodes. The call was refused before anything ran or was charged
([Links to other sites](tools.md#links-to-other-sites)).

To go on, upload the file and pass what the upload returns:

1. Have the file uploaded: `request_image_upload`, `request_video_upload` or
   `request_audio_upload` (or an upload widget) for a file the person has, or
   `prepare_*_upload` when your client can upload the file itself.
2. Pass the `public_url` the upload tool returned (or the file's asset id)
   where the link was. A file the deployment generated (a job's result), an
   asset id, a job id and an entity id are always accepted.

A link to the deployment's own storage is refused too when it is not written
exactly as the deployment hands it out — an uppercase host, a space, a
backslash, `..`, or an image transform of the content network: pass the link
exactly as a result or an upload gave it to you. A link inside a prompt is text
and never refused.

## Adding the connector to Claude.ai shows an OAuth error {#claude}

1. Verify the URL is exactly `https://mcp.nodaro.ai/mcp` (no trailing slash).
2. Confirm `mcp.nodaro.ai` resolves: `dig mcp.nodaro.ai`
3. Verify discovery: `curl https://mcp.nodaro.ai/.well-known/oauth-protected-resource`
   Expected: 200 with JSON. The same host also serves
   `/.well-known/oauth-authorization-server` (200 with JSON).

## Login never completes / connector URL is wrong {#wrong-url}

The MCP endpoint is served **only** at `https://mcp.nodaro.ai/mcp`. Two
common misconfigurations fail before the login flow ever reaches the
server, so nothing appears in any log:

- `https://api.nodaro.ai/mcp` — this domain does not exist; the connector
  fails at DNS resolution.
- `https://app.nodaro.ai/mcp` — that path is the MCP *marketing page*, not
  the endpoint. A `POST` there returns `405` with
  `{"error":{"code":"wrong_mcp_host", ...}}` pointing at the correct URL.

Connector URLs cannot be edited in place in Claude.ai — delete the broken
connector and re-add it with `https://mcp.nodaro.ai/mcp`.

## "Client not allowed" error

Your MCP client's `client_name` isn't on the allowlist. Either:
- Use a supported client (Claude, Cursor, Cline, Continue, Goose), OR
- Ask the operator of your Nodaro instance to add your client_name to `MCP_DCR_ALLOWLIST`, OR
- Set `MCP_DYNAMIC_REGISTRATION=open` if you operate the instance.

## "This deployment accepts MCP connections only from the clients it has set up" {#listed-clients}

The deployment lets only the MCP clients it set up itself use its MCP
endpoint (its operator listed them in `MCP_ALLOWED_CLIENT_IDS`; see
[MCP only through your own client](../deployment.md#mcp-only-through-your-own-client)).
What your client sees depends on where it is stopped:

| Where | What comes back |
|-------|-----------------|
| Registering itself (`POST /v1/oauth/register`) | `403` `{"error":{"code":"dcr_disabled",…}}` — the same answer as a deployment with registration turned off |
| Signing in (`GET /v1/oauth/authorize`) | The browser goes straight back to the client's callback with `error=unauthorized_client` and an `error_description`; no consent screen is shown |
| The consent page opened directly, or consent | `403` `{"error":{"code":"mcp_client_not_allowed",…}}`; the page shows the message and no Allow button |
| Exchanging a code for a token | `400` `{"error":"unauthorized_client","error_description":…}` |
| Calling the MCP endpoint with a token of another client, a signed-in session or a personal API token | `403` `{"error":{"code":"mcp_client_not_allowed",…}}` |
| Calling it while the client cannot be looked up | `503` `{"error":{"code":"mcp_client_check_failed",…}}` — try again |

None of these name the deployment's clients. There is nothing to change in
your client: on such a deployment, connect through the app the deployment
provides. A client that was working stops at its next call once the operator
removes it from the list.

## A deployment's own application cannot exchange an assertion for a token {#assertion-exchange}

For the server of a deployment's own application using the
[assertion exchange](../oauth-flow.md#assertion-exchange)
(`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`). What
`POST /v1/oauth/token` answers, and what to check:

| Answer | What it means |
|--------|---------------|
| `400` `invalid_request` "Invalid input: expected \"authorization_code\"" | The exchange is **off** for your client: the deployment has not turned it on, or not for this `client_id` (it must be in both `MCP_ALLOWED_CLIENT_IDS` and `MCP_ASSERTION_EXCHANGE_CLIENT_IDS`, active, and a provider must set `exchangeAudience`). Ask the operator; `/.well-known/oauth-authorization-server` lists `urn:ietf:params:oauth:grant-type:jwt-bearer` in `grant_types_supported` only where it is on. |
| `400` `invalid_request` (another description) | A part is missing — usually `assertion`, which must be in the body, not the URL |
| `401` `invalid_client` | No `client_secret`, or the wrong one (a rotated secret your server still caches) |
| `400` `invalid_target` | `resource` is missing or is not the MCP endpoint this deployment states for the host you called; the description names the right one |
| `400` `invalid_scope` | You asked for a scope your client may not request; ask for fewer, or have the operator widen the client's scopes |
| `400` `invalid_grant`, about the assertion | Its description says what: the signature (HS256, the provider's secret), the `aud` (the provider's **exchange** audience — a sign-in assertion is never accepted, nor one naming both audiences), expiry or a lifetime over the provider's `maxLifetimeSeconds` (check your server's clock), a missing `jti` or email, or a `jti` already used (by the exchange or by a sign-in) |
| `400` `invalid_grant` "The assertion does not name a person this application can obtain a token for." | The person cannot be signed in by the provider's assertions: an unverified address with no account yet, an existing account the linking rules do not adopt, a blocked account — or they revoked your app in Connected apps, which only their own consent undoes. The answer is the same in every case on purpose; the operator's log says which (`account_…` outcomes). |
| `429` `slow_down` | More than 300 exchanges a minute from your network or for your client; wait `Retry-After` seconds. Reuse a token for its hour instead of exchanging per request. |
| `503` `temporarily_unavailable` | The deployment cannot check the exchange right now (its Redis); try again shortly |
| `500` `server_error` | The token could not be issued. A deployment whose database does not have the token grant-type column yet refuses every exchange this way until its update lands |

A token that worked and then gets `401` from the MCP endpoint has expired (an
hour by default) or was revoked: exchange again. One that gets
`403 mcp_client_not_allowed` belongs to a client the deployment no longer lists
([above](#listed-clients)).

## "via MCP" trigger badge shows but I didn't use MCP

A connected MCP client may have submitted a job on your behalf. Open
**Settings → Connected apps** (`app.nodaro.ai/settings/connected-apps`),
which lists every app and AI assistant with access to your account and when
each was last used, and revoke any you don't recognise. Revoking ends its
access at once.

## Why is the consent screen showing an orange warning about a "self-claimed name"?

When an MCP client registers with Nodaro via RFC 7591 Dynamic Client
Registration, the client name (e.g. "Claude") is self-reported and not verified
by Nodaro. The orange notice on the consent screen is a reminder to confirm the
application requesting access is the one you're actually using before approving.

## A balance refusal says to ask the deployment's operator {#balance-managed}

On a deployment that manages its users' balance (no self-serve purchase, or an
external wallet that holds each user's balance), a tool refused for want of
balance answers that the balance is managed by the deployment and that the user
can ask its operator for more, instead of telling you to top up, upgrade or
buy: nothing can be bought from a connected client there. `check_balance` shows
what the user has left, in the deployment's own unit when it has one; an amount
it could not read is `null`, never `0`. See [Amounts on a deployment with its
own unit](tools.md#deployment-unit).
