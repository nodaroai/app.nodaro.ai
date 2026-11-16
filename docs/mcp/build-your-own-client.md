# Build your own MCP client against Nodaro

Nodaro's MCP server speaks standard MCP over Streamable HTTP. Connect any
MCP-compatible client by:

1. Pointing the client at `https://mcp.nodaro.ai/mcp`.
2. Letting it discover OAuth via `https://mcp.nodaro.ai/.well-known/oauth-protected-resource`.
3. Performing the standard OAuth Dynamic Client Registration flow (RFC 7591) at
   `https://app.nodaro.ai/v1/oauth/register`.

On a deployment that serves MCP by path
([MCP by path](../deployment.md#mcp-by-path-no-dedicated-mcp-host)) all three
are on the host you connect to: the endpoint is `https://<host>/v1/mcp`, its
401 challenge names its metadata document in `resource_metadata`
(`https://<host>/.well-known/oauth-protected-resource/v1/mcp`), and the issuer
and registration endpoint are on `https://<host>`.

## The GET stream

A Streamable HTTP client may open a `GET` on the MCP endpoint, with
`Accept: text/event-stream`, to receive messages the server starts. Nodaro's
server never starts one: every request is answered in its own response, so a
client that does not open the stream misses nothing. The stream stays silent:
nothing is sent on it after the response headers. Expect it to be closed when
it has been idle for a while (by a proxy on the way, or when the server
restarts), and simply reopen it. A `GET` without `text/event-stream` in its
`Accept` header is answered `406`.

## Allowlist gate

By default, dynamic registration only accepts known client names. The default
allowlist is: Claude, Claude Code, Cursor, Cline, Continue, Goose, ChatGPT,
OpenAI, Lovable, Gemini, Gemini CLI, Codex, MCP Inspector, mcp-inspector. The
operator controls this via two env vars: `MCP_DCR_ALLOWLIST` (comma-separated
client names) and `MCP_DYNAMIC_REGISTRATION` (`allowlist` — the default — / `open`
to accept any client / `off` to disable DCR entirely). To let any client register
on a hosted instance, set `MCP_DYNAMIC_REGISTRATION=open` in the backend env.

A deployment that lists its MCP clients (`MCP_ALLOWED_CLIENT_IDS`) accepts
no self-registered client at all: registration answers `403 dcr_disabled`, and
only the clients the deployment created can sign in for MCP or call the
endpoint — see [MCP only through your own client](../deployment.md#mcp-only-through-your-own-client)
and the [refusals a client sees](./troubleshooting.md#listed-clients).

## A deployment's own application, without a consent screen {#own-application}

On a deployment that lists its MCP clients, the client it set up for its own
application normally signs each person in once through the deployment's
consent screen. When that application also signs the people in (it is the
deployment's [external SSO](../sso.md) provider), the deployment can let its
**server** skip the consent screen: it signs an assertion naming the person and
exchanges it for an MCP access token at `POST /v1/oauth/token` with
`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`.

1. The operator turns it on for your client
   ([MCP without a consent click](../deployment.md#mcp-without-a-consent-click-the-assertion-exchange))
   and gives your server three values: your `client_id` and client secret, and
   the provider's exchange audience (the provider's secret you already hold).
2. When a person needs MCP, your server signs an assertion for them (HS256,
   `aud` = the exchange audience, a fresh `jti`, a lifetime of a minute or two)
   and exchanges it, naming the MCP endpoint as `resource`
   ([the request and response](../oauth-flow.md#assertion-exchange)).
3. Connect to the MCP endpoint with the token (`Authorization: Bearer …`):
   `initialize`, `tools/list`, `tools/call` as with any client. It lives an
   hour by default (`expires_in`); exchange again before then, or on a `401`.
   There is no refresh token.

Keep all of it on your server: the client secret and the provider's secret
together obtain a token for anyone the provider can sign in. If a call answers
something unexpected, see
[troubleshooting the exchange](./troubleshooting.md#assertion-exchange).

## Manual registration

For a long-lived integration, prefer registering once via the dashboard:
`app.nodaro.ai/(dashboard)/settings/developer-apps`. You'll get a stable
`client_id` + `client_secret` that doesn't expire (rotate via the dashboard).

## Reference

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Apps spec](https://modelcontextprotocol.io/specification)
