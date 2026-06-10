# Nodaro Documentation

Nodaro is an AI workflow editor. It lets you compose text-to-image,
AI video generation (text-to-video and image-to-video unified in the
Generate Video node), audio synthesis, video composition, and LLM nodes
into multi-step DAGs that run autonomously on a server. The backend is
REST-first; the included visual editor is one of many possible clients.

## Quickstart by goal

- **Self-host Nodaro for my team** → [Community Edition Quickstart](./community-edition-quickstart.md)
- **Build a server-side integration** → [API Integration](./api-integration.md) → [OAuth Flow](./oauth-flow.md)
- **Build a custom frontend** → [SDK Quickstart](./sdk-quickstart.md) → [SDK Reference](./sdk-reference.md)
- **Build Nodaro's parameter pickers in your own app** (Mood, Framing, Lens, Voice…) → [Picker Catalogs](./picker-catalogs.md)
- **Keep characters/products consistent across generations** (boards, cast grids, model choice) → [Reference Boards Guide](./reference-boards-guide.md)
- **Run Nodaro from the terminal** → [CLI](./cli.md)
- **Embed a published Nodaro app in an external UI** (Lovable / v0 / Bolt) → [Embed App Guide](./embed-app-guide.md)
- **Script Character Studio (REST / SDK / CLI / MCP)** → [Character Platform](./character-platform.md)
- **Browse & clone the shared community library** (admin-curated characters / locations / objects; Business + Cloud) → [Community Library](./community-library.md)
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
- `@nodaro/client` — typed REST client (3 auth modes, 17 resource classes)
- `@nodaro/cli` — terminal client wrapping `@nodaro/client`; also distributed as standalone binaries via [GitHub Releases](https://github.com/nodaroai/app.nodaro.ai/releases)

## API reference

- OpenAPI 3.1 spec: `GET /v1/openapi.json` from your Nodaro instance
- Node metadata discovery: `GET /v1/nodes`

## Support

- GitHub Issues: https://github.com/nodaroai/app.nodaro.ai/issues

## License

Sustainable Use License — see [LICENSE](../LICENSE).
