# Deployment

This guide is for **operators** self-hosting Nodaro. It walks through
prerequisites, a full Community-edition setup, reverse proxy and HTTPS,
admin promotion, the three-edition matrix, updates, scaling, backups,
and common failure modes.

For a "just paste these commands" version, see the
[Community Edition Quickstart](./community-edition-quickstart.md). This
file is the same flow with explanations.

## 1. Prerequisites

You need:

- **Docker 24+** and **Docker Compose v2** (`docker compose` not
  `docker-compose`).
- **A Supabase project.** Create one at <https://supabase.com> (free
  tier is fine for testing and small teams) or run Supabase yourself.
  You'll need: project URL, service-role key, anon key.
- **An S3-compatible object store** for assets. Tested options:
  Cloudflare R2 (recommended, zero egress), AWS S3, MinIO, Backblaze
  B2. The bucket must be readable from the public internet (assets are
  served via signed URLs and direct public links).
- **At least one AI provider key**, otherwise no nodes can run:
  - [KIE.ai](https://kie.ai) — broadest model coverage (image, video,
    audio, LLM).
  - [Replicate](https://replicate.com) — alternative provider with its
    own catalog.
  - [Anthropic](https://www.anthropic.com) — LLM fallback.
  - [ElevenLabs](https://elevenlabs.io) — voice features (TTS, dubbing,
    voice clone, voice changer, forced alignment).

Optional:

- **Node.js 22+** if you plan to run the backend or workers outside
  Docker (development workflow).
- **A domain + TLS certificate** for production deployments.

## 2. Setup walkthrough — Community edition

### 2a. Clone and configure

```bash
git clone https://github.com/nodaroai/app.nodaro.ai.git nodaro
cd nodaro
cp .env.example .env
```

Open `.env` and set the required values:

```bash
EDITION=community
PUBLIC_URL=http://localhost:3000

SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...

# At least one of these:
KIE_API_KEY=
REPLICATE_API_TOKEN=
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=

# Required in Cloud edition for character LoRA training callbacks.
# Get from `replicate.webhooks.default.secret` or the Replicate dashboard.
# When unset, the webhook fast-fails 503 webhook_not_configured.
REPLICATE_WEBHOOK_SECRET=

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=nodaro-assets
R2_PUBLIC_URL=https://pub-….r2.dev    # or your custom domain
```

### 2b. Generate internal secrets

Both required, both 32 bytes hex:

```bash
echo "INTERNAL_ORCHESTRATOR_SECRET=$(openssl rand -hex 32)" >> .env
echo "SOCIAL_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
```

`INTERNAL_ORCHESTRATOR_SECRET` authenticates the orchestrator process to
the API server within a Nodaro container. `SOCIAL_ENCRYPTION_KEY` is
AES-256-GCM key material used to encrypt social-OAuth tokens at rest.

### 2c. Apply database migrations

In the Supabase dashboard for your project, open **SQL editor** and
paste each file from `supabase/migrations/` in **filename order**
(zero-padded prefixes are intentional — `001_…sql`, `002_…sql`, …).

Faster path with the Supabase CLI:

```bash
supabase link --project-ref YOUR-REF
supabase db push
```

Migrations are idempotent except where they explicitly aren't (e.g.
seeded data); re-running them on a fresh DB is fine.

### 2d. Configure object storage

Cloudflare R2 example:

1. Create a bucket called `nodaro-assets` (or anything; match
   `R2_BUCKET_NAME`).
2. Under the bucket → **Settings**, expose a public **r2.dev**
   subdomain or attach a custom domain. Copy that URL into
   `R2_PUBLIC_URL`.
3. Under **Manage R2 API tokens**, mint an access key with
   `Object Read & Write` on this bucket. Copy `R2_ACCESS_KEY_ID` /
   `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID`.

For MinIO or AWS S3, use the same env vars — the SDK is
S3-compatible. Set `R2_PUBLIC_URL` to the bucket's public URL.

### 2e. Start the stack

```bash
docker compose -f docker-compose.community.yml up
```

First boot takes 5–10 minutes (Node deps, Remotion bundling, frontend
build). Subsequent boots are seconds. You'll see logs from Redis and
the `nodaro` service interleaving.

When you see:

```
nodaro-1  | server listening on http://0.0.0.0:9000
```

…the backend is live. Caddy fronts it on port 3000. Open
<http://localhost:3000>.

### 2f. First login

Sign up via the UI (email + password). Supabase Auth creates the user;
your Nodaro instance creates a row in `profiles` automatically.
Community edition users are unrestricted — there's no credit ledger and
no admin panel.

That's it. The next sections cover production hardening.

## 3. Reverse proxy + HTTPS

The container already runs Caddy internally on port 3000 — it serves the
frontend statics and proxies `/v1/*` to the Fastify backend on port
9000. For HTTPS you have two options:

**Option A — Front Caddy with another reverse proxy.** Recommended if
you already run nginx or another proxy.

```nginx
server {
  listen 443 ssl http2;
  server_name nodaro.example.com;
  ssl_certificate     /etc/letsencrypt/live/nodaro.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/nodaro.example.com/privkey.pem;

  client_max_body_size 100M;
  proxy_buffering off;          # important for SSE

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

**Option B — Caddy on the host with auto-HTTPS.**

```caddy
nodaro.example.com {
  reverse_proxy 127.0.0.1:3000 {
    flush_interval -1
  }
}
```

Caddy will obtain a Let's Encrypt cert automatically. Make sure ports
80 and 443 are open and that the domain's A/AAAA records point at the
host.

After any of these, update `.env`:

```bash
PUBLIC_URL=https://nodaro.example.com
CORS_ORIGIN=https://nodaro.example.com
```

…and restart the stack so the frontend's Vite build picks up the new
`PUBLIC_URL`.

## 4. First user + admin promotion

Community edition has no admin panel, but Business and Cloud do. To
mark a user as admin (after they've signed up), open the Supabase
dashboard → **SQL editor** → run:

```sql
UPDATE profiles
   SET role = 'admin'
 WHERE id = '<user_uuid>';
```

The user UUID is visible in **Authentication → Users**. The change
takes effect on next request — Nodaro caches admin status for 30
seconds.

## 5. Three editions

| | Community | Business | Cloud |
|---|---|---|---|
| Self-hostable | yes | yes | no — managed only |
| Admin panel | no | yes | yes |
| User management UI | no | yes | yes |
| Credit ledger | no | no | yes |
| Stripe billing webhooks | no | no | yes |
| Markup on AI provider cost | no | no | yes |

Switch by changing `EDITION=community|business|cloud` and restarting.
Edition is read at startup; there is no migration cost moving
Community → Business (no DB schema changes between them). Moving to
Cloud requires Stripe wiring — see `backend/CLAUDE.md` and the
`subscriptions`/`credit_transactions`/`stripe_customers` tables.

The frontend reads its edition from the `VITE_EDITION` env var at
**build time** (Vite inlines it). When switching editions, rebuild the
frontend image:

```bash
docker compose -f docker-compose.community.yml build --no-cache nodaro
docker compose -f docker-compose.community.yml up
```

Other build-time frontend env vars (all `VITE_*`, all inlined by Vite at
build time):

| Var | Description |
|---|---|
| `VITE_STUDIO_URL` | Base URL of the external Studio app (studio.nodaro.ai) for "Open in Studio" deep links. Default `https://studio.nodaro.ai`. |

## 6. Updating

Pull, rebuild, restart:

```bash
git pull
docker compose -f docker-compose.community.yml down
docker compose -f docker-compose.community.yml build
docker compose -f docker-compose.community.yml up
```

If new files appear under `supabase/migrations/`, apply them in
filename order **before** restarting (same flow as §2c). The backend
won't crash on a missing migration, but specific routes will 500 until
their schema lands.

We aim to keep migrations forward-compatible (new tables, additive
columns) — if anything changes destructively, it'll be called out in
the changelog. Pin to a specific commit/tag if you need to be cautious.

## 7. Scaling

The stock `docker-compose.community.yml` runs everything in a single
container: API server + video worker + render worker + orchestrator +
Redis + Caddy. That's fine up to ~5 active users.

For more scale, split the workers into separate containers. Inspect
`/app/start.sh` (baked into the image) — it launches four Node
processes side by side:

| Process | What it does | CPU/mem profile |
|---|---|---|
| `node dist/server.js` | Fastify HTTP API | low CPU, moderate memory |
| `node dist/worker.js` | Video worker (per-node BullMQ jobs, calls AI providers) | I/O-bound, high concurrency |
| `node dist/render-worker.js` | Remotion renderer (headless Chrome) | CPU-bound, 1–2 per box |
| `node dist/orchestrator.js` | Workflow orchestrator (DAG executor) | I/O-bound, low CPU |

A typical split:

- 1× API container with `server.js` only.
- N× video-worker containers (`VIDEO_WORKER_CONCURRENCY=50` is fine).
- 1–2× render-worker containers, each on its own VM/box.
- 1× orchestrator container.

All containers share the same Redis + Supabase + R2. They don't talk
to each other directly — Redis (BullMQ) is the only coordination
point.

**Redis HA**: BullMQ supports Redis cluster mode out of the box. Set
`REDIS_URL` to a cluster endpoint or a Sentinel URL.

**Object storage**: configure bucket-level lifecycle rules on R2/S3 to
expire old assets (e.g. 90 days). Nodaro never deletes assets itself —
it only references them by key.

## 8. Backups

Three things are stateful:

- **Supabase Postgres** — workflows, profiles, jobs, assets metadata.
  Use Supabase's Point-in-Time Recovery (paid plans) or run regular
  `pg_dump` against the DB. This is the only backup that really
  matters; users would notice it the most.
- **R2 / S3 bucket** — generated images, videos, audio. Enable
  bucket-level versioning and a long-tailed lifecycle rule so deletes
  are recoverable. Optional cross-region replication for disaster
  recovery.
- **Redis** — only ephemeral job state. If you lose Redis, in-flight
  workflows fail; everything else recovers from Postgres on restart.
  Don't bother backing up Redis.

If you take Postgres down for migration or recovery, the backend will
crash-loop until it's reachable. That's fine — once Postgres is back,
restart the Nodaro container and it'll pick up.

## 9. Troubleshooting

**"Missing or invalid env vars" on startup.** The error message lists
which Zod-validated vars are wrong. Common culprits:
`SUPABASE_SERVICE_ROLE_KEY` empty, `INTERNAL_ORCHESTRATOR_SECRET` shorter
than 32 chars.

**Frontend renders, but the editor stays blank or "Loading…" forever.**
Open the browser console. If you see CORS errors, set `CORS_ORIGIN` to
your real public URL and restart. If you see Supabase auth errors,
double-check `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` were set
**at Docker build time** (Vite inlines them into the bundle — runtime
env vars don't help).

**Migration failure: "relation … does not exist".** A migration ran
out of order. Apply migrations from `supabase/migrations/` in filename
order via the Supabase SQL editor. Each is idempotent against an
already-applied state.

**OAuth callback returns 500.** Confirm migration `093_developer_apps.sql`
ran. Without it, the `developer_apps`/`developer_app_authorizations`/
`developer_app_tokens` tables don't exist and the OAuth route handler
errors when it tries to insert.

**R2 upload returns 401 / 403.** Recheck the API token has
`Object Read & Write` on the bucket. If you front R2 with a custom
domain, also check the bucket's **public access** setting — Nodaro
returns public R2 URLs to the browser, so reads must work without
auth.

**Workflows enqueue but never start running.** Check the worker logs
(`docker compose logs nodaro` in the single-container layout). The
orchestrator only picks up jobs from Redis — if Redis is unreachable,
nothing runs. Confirm `REDIS_URL` is correct and Redis is healthy
(`docker compose exec redis redis-cli ping` should return `PONG`).

**A specific node type 500s with `Missing API key`.** That node calls
a provider whose env var is unset. Add `KIE_API_KEY` /
`REPLICATE_API_TOKEN` / `ANTHROPIC_API_KEY` / `ELEVENLABS_API_KEY` per
your needs and restart.

**Film Director pipelines (Cloud) stall at "running" and never
resume.** A pipeline's orchestration job can be lost — a re-drive that
arrives while the previous drive is still active is deduped away by
BullMQ, or a restart lands between drives — leaving the row at
`status='running'` with no worker scheduled. A periodic reconciler can
re-drive these automatically. It is **off by default**; enable it with
`PIPELINE_RECONCILE_CRON_ENABLED=true` on the API service. The
reconciler only re-drives pipelines with no pending user action, so
manual-mode runs paused at an approval gate are left untouched.

If you're still stuck, file an issue with the Docker logs at
<https://github.com/nodaroai/app.nodaro.ai/issues>.

## 10. MCP integration (optional)

The MCP (Model Context Protocol) server lets Claude.ai, Cursor, Cline,
Continue.dev, Goose, and any MCP-compatible client drive Nodaro tools on
a user's behalf via OAuth. It is gated behind `MCP_ENABLED` (default
`false`) and lives at the `mcp.nodaro.ai/mcp` subdomain.

**To enable on a hosted instance:**

1. **Add a custom subdomain** for `mcp.<your-domain>` pointing at the
   same backend service. On Railway:
   ```bash
   railway domain add mcp.your-domain.com --service backend
   ```
   Or in the Railway dashboard: Project → backend service → Settings →
   Domains → Add custom domain. Add the CNAME at your DNS provider (no
   Cloudflare proxy — proxies break long-lived SSE connections).

2. **Set env vars on the backend service.** Only `MCP_ENABLED` is required —
   the other two have safe defaults you typically don't need to change:
   ```
   MCP_ENABLED=true                              # required (default: false)
   ```
   Optional overrides:
   ```
   MCP_DYNAMIC_REGISTRATION=open                 # default: "allowlist" (recommended)
   MCP_DCR_ALLOWLIST=Claude,Cursor,Cline,Continue,Goose,YourCustomClient
                                                 # default already includes 14 clients: Claude, Claude Code, Cursor,
                                                 # Cline, Continue, Goose, ChatGPT, OpenAI, Lovable, Gemini,
                                                 # Gemini CLI, Codex, MCP Inspector, mcp-inspector
   ```

3. **Verify discovery endpoints** are reachable:
   ```bash
   curl https://mcp.your-domain.com/.well-known/oauth-protected-resource
   curl https://your-domain.com/.well-known/oauth-authorization-server
   ```
   Both should return JSON with 200 status.

4. **Add the connector** in your MCP client. In Claude.ai: Settings →
   Connectors → Add custom connector → URL `https://mcp.your-domain.com/mcp`.

The MCP server is fully shipped with 122+ tools across ~20 tool files,
covering all generation verbs (image, video, audio, character, location,
object), gallery, workflows, apps, saved components, characters, locations,
objects, pipelines, models, and more. Authentication is via OAuth
(Dynamic Client Registration for supported clients).

## See also

- [Community Edition Quickstart](./community-edition-quickstart.md) —
  shorter, opinionated version of this guide
- [Architecture](./architecture.md) — how the pieces fit together
- [Edge modes](./edge-modes.md) — request flow, auth, edition gates
- [API Integration](./api-integration.md) — once you're up, talk to
  your instance from your own server
