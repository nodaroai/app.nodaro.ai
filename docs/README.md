# Nodaro Documentation

Nodaro is an AI workflow editor. It lets you compose text-to-image,
AI video generation (text-to-video and image-to-video unified in the
Generate Video node), audio synthesis, video composition, and LLM nodes
into multi-step DAGs that run autonomously on a server. The backend is
REST-first; the included visual editor is one of many possible clients.

## Quickstart by goal

- **Self-host Nodaro for my team** → [Community Edition Quickstart](./community-edition-quickstart.md)
- **Learn the editor with guided tutorials** (the Tutorials list under Level up on the home screen's Explore tab; self-host installs seed a starter set on first boot) → [Tutorials](./tutorials.md)
- **Use Nodaro Cloud models from my self-hosted instance** → [Community Cloud-Connect](./community-cloud-connect.md)
- **Build a server-side integration** → [API Integration](./api-integration.md) → [OAuth Flow](./oauth-flow.md)
- **Let a trusted external identity provider sign users in** (LibreChat-style assertion exchange, or Supabase-native OIDC/SAML) → [External SSO](./sso.md)
- **Run a school or a team on Nodaro Cloud** (workspaces, invitations, join codes, audit — from the app, the [SDK](./sdk-reference.md#clientorganizations), the [CLI](./cli.md#working-in-a-workspace) or [MCP](./mcp/tools.md#workspace-tools)) → [Organizations](./organizations.md)
- **Build a custom frontend** → [SDK Quickstart](./sdk-quickstart.md) → [SDK Reference](./sdk-reference.md)
- **Build Nodaro's parameter pickers in your own app** (Mood, Framing, Lens, Voice…) → [Picker Catalogs](./picker-catalogs.md)
- **Keep characters/products consistent across generations** (boards, cast grids, model choice) → [Reference Boards Guide](./reference-boards-guide.md)
- **Control what each wired reference contributes** (identity, outfit, background, style — role labels + identity-lock) → [Reference Roles Guide](./reference-roles-guide.md)
- **Pick the right model for a task** (everyday vs premium tiers, use-case → model table) → [Choosing Models](./choosing-models.md)
- **Switch the editor's language** (app chrome + picker catalogs, one setting, saved to your account) → [Language Picker](./language-picker.md)
- **Enrich prompts with reusable fragments** (Identity Lock, Golden Hour, Slow Dolly-In — `/` slash menu) → [Prompt Snippets](./prompt-snippets.md)
- **Move a workflow between accounts or installs** (the home screen's Import JSON button, the editor's Export, and what happens to entities and media) → [Workflow Import & Export](./workflow-import-export.md)
- **Run Nodaro from the terminal** → [CLI](./cli.md)
- **Embed a published Nodaro MiniApp in an external UI** (Lovable / v0 / Bolt) → [Embed App Guide](./embed-app-guide.md)
- **Embed the 3D scene previsualization viewport in my own app** (stateless iframe, postMessage, no auth) → [Scene3D Preview Embed](./scene3d-embed.md)
- **Script Character Studio (REST / SDK / CLI / MCP)** → [Character Platform](./character-platform.md)
- **Read and write a studio production from a script or an agent** (the shots, the plan, the generations — the same production that opens in the studio editor; Cloud) → [Studio Productions API](./api/studio-productions.md) → [over MCP](./mcp/studio-productions.md)
- **Browse & clone the shared community library** (admin-curated characters / locations / objects; Business + Cloud) → [Community Library](./community-library.md)
- **Build a workflow by describing it** (in-app chat that edits your canvas; Cloud) → [Workflow Copilot](./features/workflow-copilot.md)
- **Wipe a run off the canvas before changing the workflow** (what Clear results removes, what it never touches, and how to get it back) → [Clear results](./features/clear-results.md)
- **See what a workflow run produced, and what reopening shows after a long run** (structured results on the canvas, nodes a Run from here only passes through, the newer run on a render and its plan) → [Run results on the canvas](./features/run-results.md)
- **Free credits on a new account** (what the signup grant is, and when activation asks for a card; Cloud) → [Free credits](./features/free-credits.md)
- **Keep the posts worth coming back to** (save Social Search results with notes and tags, find them again; Cloud) → [Inspiration](./features/inspiration.md)
- **Give a workflow a place to keep what it produces** (collections of records a workflow saves and reads back: one record per story, caps per plan, CSV / JSON export) → [Collections](./features/collections.md)
- **Know what your competitors are doing, and what to do about it** (tracked brands, scheduled scans, action cards; Cloud) → [Competitors](./features/competitors.md)
- **Connect an AI client (Claude.ai, Cursor, Cline, Continue, Goose) via MCP** → [MCP](./mcp/index.md)
- **Contribute to Nodaro** → [Architecture](./architecture.md) → [Contributing](./contributing.md)

## Editions

- **Community** — self-hosted, no credits, no admin panel, no billing
- **Business** — self-hosted with admin panel + user management
- **Cloud** — full SaaS with credits + billing (powers nodaro.ai)

Set `EDITION=community|business|cloud` to switch.

## Packages

Three npm packages in this repo:

- `@nodaro/shared` — pure-logic types, model registries, prompt helpers, [picker catalogs](./picker-catalogs.md)
- `@nodaro/sdk` — typed REST client (3 auth modes, a typed resource class per `/v1` surface — the full inventory lives in the [SDK Reference](./sdk-reference.md))
- `@nodaro/cli` — terminal client wrapping `@nodaro/sdk`; also distributed as standalone binaries via [GitHub Releases](https://github.com/nodaroai/app.nodaro.ai/releases)

## API reference

- OpenAPI 3.1 spec: `GET /v1/openapi.json` from your Nodaro instance
- Node metadata discovery: `GET /v1/nodes`

## Support

- GitHub Issues: https://github.com/nodaroai/app.nodaro.ai/issues

## License

Nodaro Sustainable Use License — see [LICENSE](../LICENSE).
