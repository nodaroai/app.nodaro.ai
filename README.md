# Nodaro

Open-source AI workflow editor. Compose text-to-image, image-to-video, audio synthesis, video composition, and LLM nodes into multi-step DAGs that run autonomously on a server.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![npm @nodaro/client](https://img.shields.io/npm/v/@nodaro/client.svg?label=%40nodaro%2Fclient)](https://www.npmjs.com/package/@nodaro/client)
[![npm @nodaro/shared](https://img.shields.io/npm/v/@nodaro/shared.svg?label=%40nodaro%2Fshared)](https://www.npmjs.com/package/@nodaro/shared)

[**Hosted version: nodaro.ai**](https://nodaro.ai) · [**Documentation**](docs/README.md) · [**SDK**](docs/sdk-quickstart.md)

## Why Nodaro

- **100+ AI nodes** — image gen, video gen, audio synthesis, lip sync, music, LLMs, social-publish
- **Visual editor** with full React Flow canvas, OR fully **headless API** for your own frontends
- **Self-hostable** — Docker Compose + Supabase + Redis, works on any cloud
- **OAuth 2.0** for third-party app integration with scoped consent
- **Typed SDK** (`@nodaro/client`) — three auth modes, error hierarchy, resource classes

## Three ways to use Nodaro

### 1. Self-host (Community Edition)

```bash
git clone https://github.com/nodaroai/app.nodaro.ai
cd app.nodaro.ai
cp .env.example .env  # fill in Supabase keys + at least one AI provider
docker compose -f docker-compose.community.yml up
```

Open `http://localhost:3000`. Full guide: [Community Edition Quickstart](docs/community-edition-quickstart.md).

### 2. SDK against the hosted API

```bash
npm install @nodaro/client
```

```typescript
import { createClient, StaticTokenAuth } from "@nodaro/client"

const nodaro = createClient({
  baseUrl: "https://nodaro.example.com",
  auth: new StaticTokenAuth(process.env.NODARO_TOKEN!),
})

const projects = await nodaro.projects.list()
const exec = await nodaro.workflows.run(workflowId)
```

Full guide: [SDK Quickstart](docs/sdk-quickstart.md).

### 3. Hosted product (closed)

[nodaro.ai](https://nodaro.ai) — managed instance with credits, billing, and zero-ops setup.

## Editions

| Edition | Self-hosted | Admin panel | Credits + billing | Use case |
|---------|-------------|-------------|-------------------|----------|
| **Community** | Yes | No | No | OSS / local / single-team |
| **Business** | Yes | Yes | No | Self-hosted with user mgmt |
| **Cloud** | No | Yes | Yes | Powers nodaro.ai |

Set `EDITION=community|business|cloud` to switch.

## Architecture

- **Frontend**: Vite 6, React Router 7, React Flow, shadcn/ui, Tailwind
- **Backend**: Fastify (Node.js/TypeScript), BullMQ (Redis)
- **Database**: Supabase (PostgreSQL + Auth)
- **Storage**: Cloudflare R2 (S3-compatible)
- **Workflow execution**: BullMQ orchestrator + frontend DAG engine

See [Architecture](docs/architecture.md) for the full system overview.

## Contributing

We welcome PRs! See [Contributing](docs/contributing.md) for the dev environment setup and standards.

The repository is a monorepo with npm workspaces:
- `backend/` — Fastify API
- `frontend/` — Vite SPA (visual editor + presentation mode + admin)
- `packages/shared/` — pure-logic types, model registries (publishes as `@nodaro/shared`)
- `packages/client/` — typed REST SDK (publishes as `@nodaro/client`)
- `packages/remotion/` — Remotion video compositions

## License

Apache 2.0 — see [LICENSE](LICENSE).
