# Nodaro Documentation

Nodaro is an open-source AI workflow editor. It lets you compose
text-to-image, image-to-video, audio synthesis, video composition, and
LLM nodes into multi-step DAGs that run autonomously on a server. The
backend is REST-first; the included visual editor is one of many possible
clients.

## Quickstart by goal

- **Self-host Nodaro for my team** → [Community Edition Quickstart](./community-edition-quickstart.md)
- **Build a server-side integration** → [API Integration](./api-integration.md) → [OAuth Flow](./oauth-flow.md)
- **Build a custom frontend** → [SDK Quickstart](./sdk-quickstart.md) → [SDK Reference](./sdk-reference.md)
- **Contribute to Nodaro** → [Architecture](./architecture.md) → [Contributing](./contributing.md)

## Editions

- **Community** (default) — fully open-source, self-hosted. No credit system, no admin panel, no Stripe.
- **Business** — self-hosted with admin panel + user management.
- **Cloud** — full SaaS with credits + billing (powers nodaro.ai).

Set `EDITION=community|business|cloud` to switch.

## Packages

Two npm packages in this repo:

- [`@nodaro/shared`](https://www.npmjs.com/package/@nodaro/shared) — pure-logic types, model registries, prompt helpers
- [`@nodaro/client`](https://www.npmjs.com/package/@nodaro/client) — typed REST client (3 auth modes, 7 resource classes)

```bash
npm install @nodaro/client
```

## API reference

- OpenAPI 3.1 spec: `GET /v1/openapi.json` from your Nodaro instance
- Node metadata discovery: `GET /v1/nodes`

(More docs in progress — this is Phase 4 of the OSS roadmap.)

## Support

- GitHub Issues: https://github.com/nodaroai/app.nodaro.ai/issues
- Discussions: https://github.com/nodaroai/app.nodaro.ai/discussions

## License

Apache 2.0 — see [LICENSE](../LICENSE).
