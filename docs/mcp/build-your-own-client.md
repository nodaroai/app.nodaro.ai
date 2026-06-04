# Build your own MCP client against Nodaro

Nodaro's MCP server speaks standard MCP over Streamable HTTP. Connect any
MCP-compatible client by:

1. Pointing the client at `https://mcp.nodaro.ai/mcp`.
2. Letting it discover OAuth via `https://mcp.nodaro.ai/.well-known/oauth-protected-resource`.
3. Performing the standard OAuth Dynamic Client Registration flow (RFC 7591) at
   `https://app.nodaro.ai/v1/oauth/register`.

## Allowlist gate

By default, dynamic registration only accepts known client names. The default
allowlist is: Claude, Claude Code, Cursor, Cline, Continue, Goose, ChatGPT,
OpenAI, Lovable, Gemini, Gemini CLI, Codex, MCP Inspector, mcp-inspector. The
operator controls this via two env vars: `MCP_DCR_ALLOWLIST` (comma-separated
client names) and `MCP_DYNAMIC_REGISTRATION` (`allowlist` — the default — / `open`
to accept any client / `off` to disable DCR entirely). To let any client register
on a hosted instance, set `MCP_DYNAMIC_REGISTRATION=open` in the backend env.

## Manual registration

For a long-lived integration, prefer registering once via the dashboard:
`app.nodaro.ai/(dashboard)/settings/developer-apps`. You'll get a stable
`client_id` + `client_secret` that doesn't expire (rotate via the dashboard).

## Reference

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Apps spec](https://modelcontextprotocol.io/specification)
