<div align="center">

# Nodaro

**The API-first studio for AI media - image, video, voice & music workflows on one canvas.**

Chain 100+ models (Seedance, Veo, Kling, Flux, ElevenLabs, Suno) into node-based pipelines.
Run them from the visual canvas, REST API, typed SDK, CLI - or let any AI drive them over MCP (150+ tools).

[Website](https://nodaro.ai) · [Hosted App](https://app.nodaro.ai) · [Documentation](https://nodaroai.github.io/app.nodaro.ai/) · [SDK Quickstart](docs/sdk-quickstart.md) · [MCP](docs/mcp/index.md)

[![CI](https://github.com/nodaroai/app.nodaro.ai/actions/workflows/ci.yml/badge.svg)](https://github.com/nodaroai/app.nodaro.ai/actions/workflows/ci.yml)
[![License: Fair-code](https://img.shields.io/badge/license-Sustainable%20Use%20%2B%20Apache--2.0-blue)](LICENSE.md)
[![Docs](https://img.shields.io/badge/docs-github%20pages-brightgreen)](https://nodaroai.github.io/app.nodaro.ai/)

https://github.com/user-attachments/assets/cedbf408-6d3c-48ad-a9cf-923467ee9d45

</div>

---
Nodaro turns multi-step AI media production — *generate an image, animate it,
voice it, lip-sync it, score it, cut it* — into workflows you can build once and run anywhere. 
The backend is **REST-first**: the included visual editor is one client of the API, 
not the product itself. Publish a workflow and it becomes an app with a shareable UI, 
an API endpoint, a webhook target, and an MCP tool — all at the same time.

## How it was made

<img width="880" height="495" alt="how_it_was_made_v3" src="https://github.com/user-attachments/assets/17b6d5c4-c28e-45c5-8ea7-b81283c0e909" />

## Highlights

- **100+ node types across 16 categories** — image, video, audio, music, LLM,
  compositing, FFmpeg processing, parameter pickers, triggers — [every one
  documented](docs/nodes/README.md).
- **100+ AI models behind one interface** — VEO, Kling, Seedance, Hailuo, Wan,
  LTX, Flux, Nano Banana, GPT-Image, Suno, ElevenLabs, Claude, Gemini, GPT and more,
  routed through pluggable providers (KIE.ai, Replicate, fal, ElevenLabs,
  HeyGen, Beeble, Apify).
- **Workflows are portable JSON** — export any workflow as a file, share it, 
    import it on any Nodaro instance (hosted or self-hosted). No lock-in.  
- **Server-side execution engine** — workflows run autonomously as DAGs on a
  BullMQ orchestrator: no browser tab required, with schedules, webhook
  triggers, sub-workflows, and per-node retry semantics.
- **Workflows as products** — publish any workflow as a shareable app with
  curated inputs/outputs, or call it programmatically via API / SDK / CLI / MCP.
- **Entity studios** — reusable characters, locations, objects, and voices with
  identity-consistent reference sets that carry across every generation.
- **Programmatic rendering** — captions, lottie overlays, 3D titles, and
  after-effects-style composites rendered with [Remotion](https://www.remotion.dev).
- **Self-hostable in two commands** — `git clone` and `docker compose up` bring
  up the whole stack (database, auth, storage, queues) on your machine, with no
  cloud accounts and no API keys to start. Bring your own provider key when you
  want to generate; fair-code, no watermarks, no metering.

## Quickstart

### Self-host (Community Edition)

Two commands. No cloud accounts, no API keys, nothing to configure:

```bash
git clone https://github.com/nodaroai/app.nodaro.ai
cd app.nodaro.ai
docker compose -f docker-compose.community.yml up
```

Then open `http://localhost:3000` and sign up with any email and password.

That single command brings up the whole stack — Postgres, auth, the data API,
object storage, Redis, and the app — and the database migrates itself on first
boot. Your first visit seeds a **Welcome Demo**: a finished script → image →
video → voice → final-cut workflow with every result already attached, so you
can click through real nodes before configuring anything.

**Where everything lives:**

| | |
|---|---|
| Database | Postgres in the stack, on a Docker volume |
| Sign-in | Email + password (no email server needed locally) |
| Generated media | MinIO in the stack, on a Docker volume |
| Job queues | Redis in the stack |

Nothing leaves your machine, and nothing phones home.

**To generate for real**, either connect your nodaro.ai account from `/setup`
(runs on cloud credits, no provider accounts needed) or paste an AI provider
key on the `/setup` screen — it's stored encrypted and live immediately, no
restart. The same keys also work as env vars in a `.env` next to the compose
file:

```bash
KIE_API_KEY=...          # kie.ai — broadest model coverage
# or
REPLICATE_API_TOKEN=...  # replicate.com
```

With your own keys you pay providers directly. The Community Edition has no
credit system, no fees, and no watermarks.

**Stuck?** `http://localhost:3000/setup` is a live health screen — database,
Redis, storage and provider keys, green or red, with the exact variable to fix.
No login required.

Full guide, including how to swap in a managed Supabase project or Cloudflare
R2, mint production keys, and put it behind a domain:
[Community Edition Quickstart](docs/community-edition-quickstart.md) ·
[Deployment](docs/deployment.md).

### Hosted

[app.nodaro.ai](https://app.nodaro.ai) — the managed instance: zero setup,
credit-based billing, every provider pre-configured.

## Use it your way

### Visual editor

A full React Flow canvas: drag nodes, wire media-typed handles (invalid
connections are rejected at drag time), run single nodes or the whole graph,
and watch results stream in live.

### API + SDK

Everything the editor does is a REST call. The typed TypeScript SDK is
published as [`@nodaro/sdk`](https://www.npmjs.com/package/@nodaro/sdk)
(Apache-2.0, source under [`packages/client`](packages/client)):

```bash
npm install @nodaro/sdk
```

```typescript
import { createClient, StaticTokenAuth } from "@nodaro/sdk"

const nodaro = createClient({
  baseUrl: "https://app.nodaro.ai",
  auth: new StaticTokenAuth(process.env.NODARO_TOKEN!),
})

const execution = await nodaro.workflows.run(workflowId)
const jobs = await nodaro.jobs.list({ status: "completed" })
```

**Not using TypeScript?** The whole surface is plain REST, and a live
[OpenAPI 3.1 spec](https://app.nodaro.ai/v1/openapi.json) covers the
automation core — generate a typed client for Go / Rust / Python with one
command: see [API Integration §9](docs/api-integration.md).

Guides: [SDK Quickstart](docs/sdk-quickstart.md) ·
[SDK Reference](docs/sdk-reference.md) ·
[API Integration](docs/api-integration.md) ·
[OAuth 2.0 flow](docs/oauth-flow.md) for third-party apps with scoped consent.

### CLI

[`packages/cli`](packages/cli) wraps the SDK for terminals and CI — multiple
profiles, `--json` output, `--watch` for following executions, and standalone
compiled binaries on the [releases page](https://github.com/nodaroai/app.nodaro.ai/releases).

```bash
npm install -g @nodaro/cli

nodaro auth login
nodaro workflows run <workflowId> --watch
```

### MCP

Drive Nodaro from Claude, Cursor, Cline, Continue, or any MCP-compatible
client — generation tools, workflow tools, and live execution widgets:

```
https://mcp.nodaro.ai/mcp
```

See [docs/mcp](docs/mcp/index.md).

## Editions

| Edition | Self-hosted | Admin panel | Credits + billing | Use case |
|---------|-------------|-------------|-------------------|----------|
| **Community** | Yes | No | No | Personal / single-team |
| **Business** | Yes | Yes | No | Self-hosted with user management |
| **Cloud** | — | Yes | Yes | Powers app.nodaro.ai |

Switch with `EDITION=community|business|cloud`. Enterprise-licensed code is
isolated under `ee/` directories — see [License](#license).

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Vite 6 · React Router 7 · [React Flow](https://reactflow.dev) · shadcn/ui · Tailwind |
| Backend | Fastify (Node.js / TypeScript) · Zod-validated routes |
| Execution | BullMQ orchestrator on Redis · server-side DAG engine |
| Rendering | [Remotion](https://www.remotion.dev) compositions · FFmpeg pipelines |
| Data | Supabase (PostgreSQL + Auth + RLS) — bundled in the self-host compose, or a managed project |
| Storage | Any S3-compatible store — MinIO bundled in the self-host compose, Cloudflare R2 in the cloud |

Deep dive: [Architecture](docs/architecture.md) ·
[Deployment](docs/deployment.md) · curated design notes in
[`docs/design/`](docs/design).

### Monorepo layout

```
backend/            Fastify API, workers, providers, workflow engine
frontend/           Vite SPA — visual editor, published apps, admin
packages/shared/    Types, model catalog, wire contracts (Apache-2.0)
packages/prompts/   Prompt catalogs, hints, presets (FSL — non-competing use)
packages/client/    Typed REST SDK, published as @nodaro/sdk (Apache-2.0)
packages/cli/       nodaro CLI, compiled binaries via bun (Apache-2.0)
packages/remotion/  Remotion video compositions (captions, lottie, 3D titles)
docker/selfhost/    First-boot SQL for the bundled Postgres (role passwords)
supabase/migrations/ Schema migrations — applied automatically on self-host boot
docs/               Public documentation (GitHub Pages)
```

## Ecosystem

Nodaro is built alongside — and embeds — open projects:

- **[FreeCut](https://github.com/nodaroai/freecut)** ([freecut.nodaro.ai](https://freecut.nodaro.ai)) —
  a professional multi-track video editor that runs entirely in the browser.
  Nodaro workflows export straight into a FreeCut timeline (including FCPXML)
  for hands-on finishing.
- **[AudioMass](https://github.com/nodaroai/audiomass)** — the web-based
  waveform editor, embedded in Nodaro for in-place trimming and editing of
  generated audio.
- **[Remotion](https://www.remotion.dev)** — powers Nodaro's programmatic
  rendering: burned captions, lottie overlays, animated 3D titles, and
  template-based composites (see [`packages/remotion`](packages/remotion)).
- **[studio.nodaro.ai](https://studio.nodaro.ai)** — a standalone creative
  studio product built entirely on the public Nodaro API and SDK: proof that
  the headless surface is complete.

## Contributing

Contributions are welcome — see [Contributing](docs/contributing.md) for dev
setup, coding standards, and the node-registration checklists.

Signing the [Contributor License Agreement](CLA.md) is required and automated:
the CLA bot will prompt on your first pull request and never again after.

## License

Nodaro is **fair-code** with three license tiers — full overview in
[`LICENSE.md`](LICENSE.md):

- **Community code** (default) — [Nodaro Sustainable Use License](LICENSE):
  free for personal use, for development/testing/evaluation at any company
  size, and for internal business use in companies of up to 3 people. Larger
  companies and any hosted service offered to third parties require a
  commercial license.
- **Enterprise code** (paths with an `ee` segment or filenames containing
  `.ee.`) — [Enterprise License](backend/src/ee/LICENSE): free for development,
  testing, and evaluation; using Enterprise features in production requires a
  Nodaro Cloud or Enterprise subscription (dormant Enterprise code inside
  community builds needs none).
- **Prompt layer** (`packages/prompts`) — [Functional Source
  License](packages/prompts/LICENSE): free for any non-competing use
  (including your commercial apps on Nodaro); not for competing products;
  Apache-2.0 two years after each release.
- **SDK packages** (`packages/shared`, `packages/client`, `packages/cli`) —
  [Apache License 2.0](packages/shared/LICENSE): embed anywhere, including
  commercial applications.

Commercial licensing: [license@nodaro.ai](mailto:license@nodaro.ai)
