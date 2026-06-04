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

- 122 tools across all media families (image / video / audio / Suno / character / location / object)
- Workflow tools (`list_workflows`, `get_workflow`, `create_workflow`, `delete_workflow`, `get_workflow_json`, `update_workflow_json`, `export_workflow`, `import_workflow`, `run_workflow`) — all scoped to an auto-created "mcp" project except `export_workflow`, which can export any of your workflows
- Prompt tools (`analyze_prompt`, `generate_prompt`, `enhance_prompt`) — AI assistance for writing prompts for generation nodes
- Other utility tools (`list_jobs`, `get_job`, `list_projects`, `get_project`, `list_models`, ...)
- Gallery tools (`browse_gallery`, `browse_uploads`, `list_favorites`, `favorite_asset`, `get_asset`, `display_asset`, `get_app_run`)
- Apps via `list_apps` / `get_app_inputs` / `run_app`; saved components via `list_components` / `get_component_inputs` / `run_component`
- Async progress tracking via MCP `tasks/*` API + interactive widgets

## Supported clients

- [Claude.ai (web)](./connecting-claude.md)
- [Cursor](./connecting-cursor.md)
- [Cline](./connecting-cline.md)
- [Continue.dev](./connecting-continue.md)
- [Goose](./connecting-goose.md)
- [Build your own MCP-compatible client](./build-your-own-client.md)

## Skills

- [Film Director](./film-director.md) — Claude Skill that drives a 10-stage director workflow (script → characters → storyboard → animation → audio → final cut) and assembles an editable Nodaro workflow on your canvas in real-time

## Under the hood

OAuth flow under the hood: see [OAuth flow](../oauth-flow.md). MCP-specific
client onboarding lives here; the OAuth handshake itself is the same
authorization-code + PKCE flow Nodaro uses for any third-party app.

## Tool reference

See [tools.md](./tools.md) for the full list of tools, inputs, and scope requirements — including project discovery (`list_projects`, `get_project`) and workflow JSON editing (`get_workflow_json`, `update_workflow_json`, `export_workflow`, `import_workflow`).

## Troubleshooting

See [troubleshooting](./troubleshooting.md).
