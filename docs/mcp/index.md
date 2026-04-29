# Nodaro MCP Server

Use any MCP-compatible AI client (Claude.ai, Cursor, Cline, Continue.dev, Goose) to drive
your Nodaro tools — generation verbs, gallery browsing, your saved components and apps.

## Quick start

Paste this URL into your MCP client's "Add custom connector" or equivalent dialog:

```
https://mcp.nodaro.ai/mcp
```

Sign in with your Nodaro account, consent, and the tools appear inline.

## What's included

- 13 generation verbs (`generate_image`, `generate_video`, `animate_image`, ...)
- 11 utility tools (`list_jobs`, `get_job`, `list_workflows`, `run_workflow`, ...)
- 4 gallery tools (`browse_gallery`, `list_favorites`, `favorite_asset`, `get_asset`)
- Your published apps and saved components surface as their own named tools (capped at 30/session)
- Async progress tracking via MCP `tasks/*` API + interactive widgets

## Supported clients

- [Claude.ai (web)](./connecting-claude.md)
- [Cursor](./connecting-cursor.md)
- [Cline](./connecting-cline.md)
- [Continue.dev](./connecting-continue.md)
- [Goose](./connecting-goose.md)
- [Build your own MCP-compatible client](./build-your-own-client.md)

## Under the hood

OAuth flow under the hood: see [OAuth flow](../oauth-flow.md). MCP-specific
client onboarding lives here; the OAuth handshake itself is the same
authorization-code + PKCE flow Nodaro uses for any third-party app.

## Troubleshooting

See [troubleshooting](./troubleshooting.md).
