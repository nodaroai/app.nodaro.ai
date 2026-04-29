# Nodaro

AI workflow editor. Compose text-to-image, image-to-video, audio synthesis, video composition, and LLM nodes into multi-step DAGs that run autonomously on a server.

[**Hosted version: nodaro.ai**](https://nodaro.ai) · [**Documentation**](docs/README.md) · [**SDK**](docs/sdk-quickstart.md)

## Features

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

### 3. Hosted product

[nodaro.ai](https://nodaro.ai) — managed instance with credits, billing, and zero-ops setup.

## MCP Integration

Drive Nodaro tools from any MCP-compatible AI client. Paste `https://mcp.nodaro.ai/mcp`
into Claude.ai / Cursor / Cline / Continue.dev / Goose. See [docs/mcp](./docs/mcp/index.md).

## Editions

| Edition | Self-hosted | Admin panel | Credits + billing | Use case |
|---------|-------------|-------------|-------------------|----------|
| **Community** | Yes | No | No | Local / single-team |
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

## Project structure

The repository is a monorepo with npm workspaces:

- `backend/` — Fastify API + workers
- `frontend/` — Vite SPA (visual editor + presentation mode + admin)
- `packages/shared/` — pure-logic types, model registries, prompt helpers
- `packages/client/` — typed REST SDK
- `packages/remotion/` — Remotion video compositions

See [Contributing](docs/contributing.md) for dev environment setup and standards.

## License

Sustainable Use License — see [LICENSE](LICENSE).
