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
- **A database + auth stack.** The community compose BUNDLES one (Supabase
  Postgres + GoTrue + PostgREST, migrations applied automatically, email +
  password sign-up) — nothing to create. Alternatively, use a managed
  project at <https://supabase.com> (free tier is fine): you'll need the
  project URL, service-role key, and anon key, and you apply
  `supabase/migrations/` yourself (see 2c).
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
  - [fal.ai](https://fal.ai) — optional; enables fal-hosted models (e.g.
    the Sync Lipsync v3 lip-sync model). Without `FAL_KEY` those models
    are inert and the rest of the app is unaffected.

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

# Optional — Google Gemini API key (https://aistudio.google.com/apikey).
# Enables the direct-Google lane for Gemini models. Without it, every Gemini
# model is served through KIE, which is the default for all but the premium
# tier. See "Gemini routing" below before setting it: the direct lane is
# billed at Google's list price, which is materially higher per token.
# NOT the same as GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (OAuth sign-in).
GEMINI_API_KEY=

# Optional — enables fal.ai-hosted models (e.g. Sync Lipsync v3).
# Without it, fal models are inert; the rest of the app is unaffected.
FAL_KEY=

# Required in Cloud edition for character LoRA training callbacks.
# Get from `replicate.webhooks.default.secret` or the Replicate dashboard.
# When unset, the webhook fast-fails 503 webhook_not_configured.
REPLICATE_WEBHOOK_SECRET=

# Storage — leave ALL of these unset to use the MinIO bundled in the
# community compose (see 2d). For Cloudflare R2, set the four R2_* values
# and keep R2_ENDPOINT / R2_FORCE_PATH_STYLE empty.
R2_ENDPOINT=
R2_FORCE_PATH_STYLE=
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

### 2b-2. Social network apps (optional, per network)

Social publishing works per-network: a network becomes connectable once its
OAuth app credentials are set. Unconfigured networks still appear in
**Settings → Integrations** (and in `GET /v1/social/providers`) as
*unavailable* with the missing variable names — nothing breaks without them.

| Network | Required env vars |
|---|---|
| Instagram | `META_APP_ID`, `META_APP_SECRET` (optional `META_INSTAGRAM_CONFIG_ID` for Facebook Login for Business) |
| Instagram (no Facebook Page) | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` — Meta issues these separately from the Facebook app. Connects an Instagram account directly, with no linked Page, and its tokens refresh on their own (~60 days) |
| Facebook | `META_APP_ID`, `META_APP_SECRET` (optional `META_FACEBOOK_CONFIG_ID`) |
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` |
| YouTube | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
| X (Twitter) | `X_CLIENT_ID`, `X_CLIENT_SECRET` |
| Telegram | none — users paste their own bot token |
| Reddit | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` |
| Pinterest | `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET` |
| Discord | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN` |
| Twitch | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` |
| Threads | `THREADS_APP_ID`, `THREADS_APP_SECRET` |
| Mastodon | `MASTODON_CLIENT_ID`, `MASTODON_CLIENT_SECRET` (optional `MASTODON_URL`, default mastodon.social) |
| Bluesky | none — users connect with a handle + app password |
| Dev.to / Hashnode / Medium | none — users connect with their own API key / token |
| WordPress | none — users connect with site URL + application password |
| Lemmy | none — users connect with instance + login + community |

Each OAuth app must whitelist the redirect URI
`https://YOUR-DOMAIN/v1/social/callback/{network}`.

When a Facebook/Instagram login manages more than one Page or Instagram
account, the connect popup shows an **account picker** — the user chooses
which account to connect (single-account logins connect directly, as before).

### 2c. Apply database migrations

**Bundled stack (compose default): automatic.** The app container applies
`supabase/migrations/` on boot (gated by `RUN_MIGRATIONS_ON_BOOT=true` +
`DATABASE_URL`, both defaulted in the compose file), tracks applied files
in `public._nodaro_migrations`, and refuses to start against a
half-migrated schema. Skip to 2d.

**Managed Supabase project:** set `RUN_MIGRATIONS_ON_BOOT=false` and apply
them yourself. In the Supabase dashboard, open **SQL editor** and
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

**Default: the bundled MinIO — nothing to configure.**
`docker-compose.community.yml` ships a MinIO service with working
defaults: `R2_ENDPOINT=http://minio:9000`, path-style addressing, and
`R2_PUBLIC_URL=http://localhost:3000/storage/nodaro-assets` (media is
proxied through the app's own origin by Caddy, so the browser and the
backend read the same URL). The bucket is auto-created with a
public-read policy on first boot. Media lives in the `minio-data`
Docker volume. Change the default credentials before exposing the
stack to a network; when serving on a real domain, set `R2_PUBLIC_URL`
to `https://<your-domain>/storage/nodaro-assets`.

**Cloudflare R2** (recommended for real deployments — zero egress):

1. Create a bucket called `nodaro-assets` (or anything; match
   `R2_BUCKET_NAME`).
2. Under the bucket → **Settings**, expose a public **r2.dev**
   subdomain or attach a custom domain. Copy that URL into
   `R2_PUBLIC_URL`.
3. Under **Manage R2 API tokens**, mint an access key with
   `Object Read & Write` on this bucket. Copy `R2_ACCESS_KEY_ID` /
   `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID`.
4. Set `R2_ENDPOINT=` and `R2_FORCE_PATH_STYLE=` (empty) so the MinIO
   compose defaults don't apply — with them empty, the endpoint is
   derived from `R2_ACCOUNT_ID`.

For any other S3-compatible store (AWS S3, Backblaze B2, self-managed
MinIO), set `R2_ENDPOINT` to its S3 API URL, `R2_FORCE_PATH_STYLE=true`
for most self-hosted servers, and `R2_PUBLIC_URL` to the bucket's
public URL.

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
`/app/start.sh` (baked into the image) — it launches five Node
processes side by side:

| Process | What it does | CPU/mem profile |
|---|---|---|
| `node dist/server.js` | Fastify HTTP API | low CPU, moderate memory |
| `node dist/worker.js` | Video worker (per-node BullMQ jobs, calls AI providers) | I/O-bound, high concurrency |
| `node dist/render-worker.js` | Remotion renderer (headless Chrome) | CPU-bound, 1–2 per box |
| `node dist/orchestrator.js` | Workflow orchestrator (DAG executor) | I/O-bound, low CPU |
| `node dist/pipeline-worker.js` | Story-to-Video pipeline orchestration (all editions; exits cleanly on non-cloud) | I/O-bound, low CPU |

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
it only references them by key. One exception: on Cloud, a daily cron
reaps transient `video-analysis-tmp/` intermediates (analysis working
files, orphaned after a worker crash). Self-hosted (Community/Business)
deployments have no such cron, so include the `video-analysis-tmp/`
prefix in your bucket lifecycle rule.

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

**Start at `/setup`.** Self-hosted (community/business) installs serve a
live health screen at `http://<your-host>/setup` (backed by
`GET /v1/setup/status`, both public — no login needed, presence booleans
only). It shows green/red cards for the database (including a dedicated
"Migrations missing" state), Redis, storage, and provider keys, with a
hint per failing card, and polls every 5 seconds. Most of the issues
below are visible there at a glance. The route does not exist on the
Cloud edition.

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
`REPLICATE_API_TOKEN` / `ANTHROPIC_API_KEY` / `ELEVENLABS_API_KEY` /
`FAL_KEY` per your needs and restart.

### Gemini routing (`GEMINI_API_KEY`)

Gemini models can be served two ways, and which lane each model uses is
declared per model in the registry (`packages/shared/src/llm-models.ts`),
not by a global switch:

| Model | Default lane | Direct lane used when |
|-------|--------------|-----------------------|
| `gemini-3-flash` | KIE | KIE fails |
| `gemini-3.6-flash` | KIE | KIE fails |
| `gemini-3.1-pro` | Direct Google | always (KIE is the fallback) |
| **video-analysis (any tier)** | **Direct Google — ONLY** | **always; there is no fallback** |

> **`GEMINI_API_KEY` is REQUIRED if you use video-analysis.** That node is
> pinned to the direct lane with no KIE fallback, so without the key every
> analysis job fails with
> `... is pinned to the direct lane but GEMINI_API_KEY is not set`.
> Set the key **before** deploying a build that includes this behaviour.

For everything else the key is optional: leave it unset and the remaining
Gemini models are served through KIE exactly as before.

Video-analysis is direct-only on purpose. KIE reaches Gemini by smuggling
media URLs through an `image_url` field rather than sending real media parts,
and its `response_format` silently drops record-shaped schema fields. A
fallback would therefore not degrade gracefully — it would return
differently-grounded analysis with no signal that anything changed. A hard
error is the honest outcome.

Two things to know before changing a model's lane:

- **Cost.** The two lanes bill the same model at materially different per-token
  rates, so moving a model to the direct lane changes what it costs to run.
  The high-volume defaults (`llm-chat`, `prompt-helper`, `qa-check`,
  `generate-script`, `translate`) all sit on `gemini-3.6-flash`, which is why
  that model stays KIE-first. The rate tables for both lanes live in
  `backend/src/lib/pricing/llm-cost.ts`, and provider cost is recorded against
  whichever lane actually served the call. Check the current published rates
  for your own keys before switching a high-volume model over.
- **Media.** The direct Google API cannot fetch arbitrary URLs. Image, video,
  and audio references are downloaded and re-sent as inline bytes (small) or
  uploaded through the Gemini Files API (large, 48-hour retention). This is
  automatic, but it means the direct lane does real I/O the KIE lane did not.

To move a model between lanes, set or remove `preferDirect` on its registry
entry — no client code changes.

**Running on arm64?** The image ships a distinct arm64 build of the same
pinned ffmpeg source. Rendered-output parity between the amd64 and arm64
builds is verified against the same characterization baseline (54/54
operations within tolerance as of the current pin); re-verify after any
ffmpeg pin bump with
`CHARACTERIZE_ARCH=arm64 backend/scripts/characterize-in-image.sh check`.

**Docker build fails downloading or checksum-verifying the ffmpeg
tarball.** ffmpeg is deliberately pinned in the Dockerfile to an exact
static build (`ARG FFMPEG_TARBALL_URL_*` + `ARG FFMPEG_TARBALL_SHA256_*`,
per architecture): rendered audio/video output differs between ffmpeg
versions (filter gain/behavior changes — the 5.1→8 jump alone changed a
convolution filter's gain semantics), so an unpinned install would let a
rebuild silently change what renders sound and look like. A download
failure or checksum mismatch fails the build loudly instead of silently
changing output. Fix: pick a newer dated release from
<https://github.com/BtbN/FFmpeg-Builds/releases>, update BOTH the URL and
SHA256 for BOTH architectures, and treat it as a real ffmpeg upgrade —
verify rendered output afterwards rather than assuming parity.

**Film Director pipelines (Cloud) stall at "running" and never
resume.** A pipeline's orchestration job can be lost — a re-drive that
arrives while the previous drive is still active is deduped away by
BullMQ, or a restart lands between drives — leaving the row at
`status='running'` with no worker scheduled. A periodic reconciler can
re-drive these automatically. It is **off by default**; enable it with
`PIPELINE_RECONCILE_CRON_ENABLED=true` on the API service. The
reconciler only re-drives pipelines with no pending user action, so
manual-mode runs paused at an approval gate are left untouched.

**Recast interactive runs stop when the user closes the tab.** Recast's
interactive lane — buying each round of image candidates, waiting out a
gate's deadline, dispatching the render — historically ran in the
browser, so a paid run went nowhere once every tab was closed. A
server-side driver takes it over: a 5-second tick asks the recast plugin
which runs owe a step and makes one. It is **off by default**; enable it
with `RECAST_DRIVER_CRON_ENABLED=true` on the API service, and confirm
`[recast-driver] started` in the boot log.

Off by default deliberately: this cron spends users' credits with no
request from them, so enabling it is a per-environment decision rather
than a side effect of deploying. It also needs the recast plugin loaded —
on an edition without it the route 404s and the cron disables itself
after one logged warning.

If you're still stuck, file an issue with the Docker logs at
<https://github.com/nodaroai/app.nodaro.ai/issues>.

## 10. MCP integration (optional)

The MCP (Model Context Protocol) server lets Claude.ai, Cursor, Cline,
Continue.dev, Goose, and any MCP-compatible client drive Nodaro tools on
a user's behalf via OAuth. It is gated behind `MCP_ENABLED` (default
a user's behalf via OAuth. It is gated behind `AUTO_RECHARGE_ENABLED` (default — enables the auto-recharge trigger/charge path (webhook provisioning always on). Default `false`.
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

2. **Set env vars on the backend service.**
   ```
   MCP_ENABLED=true                              # required (default: false)
   MCP_PUBLIC_URL=https://mcp.your-domain.com    # the domain from step 1
   ```
   `MCP_PUBLIC_URL` is what the discovery endpoints advertise as the
   protected-resource identity (RFC 9728) and what upload links point at —
   without it your instance advertises the Nodaro Cloud MCP host. If you
   serve MCP from your main domain instead of a subdomain, set it to the
   same value as `PUBLIC_URL`.

   Optional overrides (safe defaults you typically don't need to change):
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

The MCP server is fully shipped with 123+ tools across ~20 tool files,
covering all generation verbs (image, video, audio, character, location,
object), gallery, workflows, apps, saved components, characters, locations,
objects, pipelines, models, and more. Authentication is via OAuth
(Dynamic Client Registration for supported clients).

## 11. Cloud-connect for self-hosted instances

Two sides, two variables — see
[Connect your instance to Nodaro Cloud](./community-cloud-connect.md) for
the flow itself.

| Where | Variable | Meaning |
|---|---|---|
| Your instance (community / business) | `NODARO_CLOUD_URL` | Cloud host the **Connect nodaro.ai** button registers with. Default `https://app.nodaro.ai`. Set to `https://next.nodaro.ai` for a staging soak. |
| Your instance (community / business) | `NODARO_API_KEY` | nodaro.ai as a provider like KIE or Replicate: a personal API token from app.nodaro.ai → Settings → API, billed to that account. Alternative to the OAuth connect flow — both light the same **nodaro.ai** tile on `/setup`; if both exist the OAuth connection is used (it carries per-instance spend caps and Connected Instances visibility). |
| The cloud (a `cloud`-edition deployment) | `COMMUNITY_CONNECT_ENABLED` | Master switch for accepting self-hosted registrations (`software_id: nodaro-community` at `/v1/oauth/register`) and for the account's **Connected Instances** page. Default `false`. Enabled on `app.nodaro.ai` since 2026-08-16. Requires migration 312 (`developer_apps.kind = community_instance`). Read at boot — redeploy after changing. |

When the cloud has it off, the instance's `POST /v1/nodaro-connect/start`
answers `503 cloud_connect_unavailable` and the setup screen says so in
place, pointing at your own provider keys instead.

## See also

- [Community Edition Quickstart](./community-edition-quickstart.md) —
  shorter, opinionated version of this guide
- [Architecture](./architecture.md) — how the pieces fit together
- [Edge modes](./edge-modes.md) — request flow, auth, edition gates
- [API Integration](./api-integration.md) — once you're up, talk to
  your instance from your own server
