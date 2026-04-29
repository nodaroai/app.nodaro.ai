# MCP Troubleshooting

## "Connected" but no tools appear

Likely cause: the granted scopes don't match what tools require. Re-authorize and
make sure all scopes are granted.

## Adding the connector to Claude.ai shows an OAuth error {#claude}

1. Verify the URL is exactly `https://mcp.nodaro.ai/mcp` (no trailing slash).
2. Confirm `mcp.nodaro.ai` resolves: `dig mcp.nodaro.ai`
3. Verify discovery: `curl https://mcp.nodaro.ai/.well-known/oauth-protected-resource`
   Expected: 200 with JSON.

## "Client not allowed" error

Your MCP client's `client_name` isn't on the allowlist. Either:
- Use a supported client (Claude, Cursor, Cline, Continue, Goose), OR
- Ask the operator of your Nodaro instance to add your client_name to `MCP_DCR_ALLOWLIST`, OR
- Set `MCP_DYNAMIC_REGISTRATION=open` if you operate the instance.

## "via MCP" trigger badge shows but I didn't use MCP

A connected MCP client may have submitted a job on your behalf. Open
`app.nodaro.ai/(dashboard)/settings/developer-apps` and review/revoke any
unexpected app authorizations.

## Why is the consent screen showing an orange warning about a "self-claimed name"?

When an MCP client registers with Nodaro via RFC 7591 Dynamic Client
Registration, the client name (e.g. "Claude") is self-reported and not verified
by Nodaro. The orange notice on the consent screen is a reminder to confirm the
application requesting access is the one you're actually using before approving.
