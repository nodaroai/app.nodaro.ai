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

**On the community compose stack, `.env` is optional** — the compose file
bundles Supabase, MinIO and Redis with working defaults, so the two-command
install in the [Community Edition quickstart](./community-edition-quickstart.md)
needs nothing configured at all. Set values here only to point at your OWN
managed services (an external Supabase project, S3-compatible storage, …):

```bash
EDITION=community
PUBLIC_URL=http://localhost:3000

# Only when using a managed Supabase project instead of the bundled stack:
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

#### Every backend variable — reference

Everything `backend/src/lib/config.ts` reads. **Required** means the API
refuses to boot without it (the community compose sets or generates all
three). Everything else has a working default. A guard test
(`backend/src/lib/__tests__/config-docs.test.ts`) fails CI if a variable is
added to `config.ts` without a row here.

| Variable | Default | What it does |
|---|---|---|
| `SUPABASE_URL` | **required** | Supabase project URL (bundled: `http://rest:3000` behind the compose network) |
| `SUPABASE_SERVICE_ROLE_KEY` | **required** | Service-role JWT the backend uses (bundled: generated on first boot) |
| `INTERNAL_ORCHESTRATOR_SECRET` | **required**, ≥ 32 chars | Shared secret between the orchestrator and the API (bundled: generated on first boot) |
| `SUPABASE_ANON_KEY` | `""` | Anon key handed to the frontend and GoTrue |
| `FRONTEND_SUPABASE_URL` | `""` (bundled: derived `PUBLIC_URL/supabase`) | Supabase URL the **browser** uses — written into `/config.js` at boot; set it when auth lives on a managed Supabase project |
| `DEFAULT_LOCALE` | `""` (browser detection) | The locale a fresh visitor starts in — e.g. `he`, `ar`, `de`, `fr`, `es`, `hi`, `ja`, `ko`, `pt-BR`, `ru`, `zh-CN`, `en`. Written into `/config.js` at boot; a user's own saved choice always wins, and an unset/blank/unrecognised value falls back to the visitor's browser language. Restart to apply |
| `NODARO_TUTORIAL_PACKS` | `""` (built-in tutorials only) | Business / self-host — comma-separated directories of extra tutorial packs (each: a `manifest.json` + one `*.json` per tutorial), mounted read-only into the container. Additive; a malformed pack is skipped and logged, never corrupting the built-in tutorials. Restart to apply. See [tutorials.md](./tutorials.md) for the pack format |
| `EDITION` | `community` | `community` · `business` · `cloud` — see §5 |
| `PUBLIC_URL` | `http://localhost:3000` | The install's public origin: OAuth callbacks, media URLs, CORS |
| `CORS_ORIGIN` | `""` | Extra allowed browser origins, comma-separated (PUBLIC_URL is always allowed) |
| `RESEND_API_KEY` | `""` | Cloud, organizations: API key for sending invitation emails through Resend. Unset = invitations are not emailed; the API returns a copy-and-paste link instead |
| `EMAIL_FROM` | `""` | Cloud, organizations: the From address for invitation emails (a verified sender on the Resend account) |
| `LOOPS_API_KEY` | `""` | Cloud: API key for syncing marketing-email consent to Loops (loops.so). Unset = the consent-to-contact sync is inert; consent is still recorded locally and reconciled once a key is set |
| `VITE_ORGS_ENABLED` | `""` | Cloud, organizations: `true` shows the organization surfaces in the browser. Build-time (Vite inlines it), so it needs the `ARG`+`ENV` pair in the Dockerfile — and it must match the backend's `ORGS_ENABLED`, or the UI offers something the API refuses |
| `PORT` / `HOST` | `8000` / `0.0.0.0` | Where the API listens (in the image the API sits on 9000 behind Caddy on 3000) |
| `NODE_ENV` | `development` | `production` in every image |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ queues + caches (bundled: `redis://redis:6379`) |
| `RUNTIME_ENV` | `RAILWAY_ENVIRONMENT_NAME`, else `local` | Names this deployment. Only matters when two installs share ONE database but have SEPARATE Redis instances (a staging + production pair): each install's stale-execution sweeps then reconcile only the runs its own orchestrator claimed, instead of marking the other install's healthy executions "orphaned". On Railway, `RAILWAY_ENVIRONMENT_NAME` already supplies it — set `RUNTIME_ENV` yourself only elsewhere. Every container of one install (API, workers, orchestrator) must use the SAME value |
| `DATABASE_URL` | `""` | Direct Postgres URL — used only to apply migrations on boot |
| `RUN_MIGRATIONS_ON_BOOT` | `false` (compose: `true`) | Apply `supabase/migrations` before the API starts; `false` on a managed Supabase project (see 2c) |
| `KIE_API_KEY` | `""` | KIE.ai — broadest media/LLM coverage (or paste it on Install health) |
| `KIE_API_BASE_URL` | `https://api.kie.ai` | Where KIE traffic goes. Point it at an egress proxy — see 12a. **Also moves the Claude/Gemini LLM lanes** |
| `REPLICATE_API_TOKEN` | `""` | Replicate — Flux 2 family, LoRA training |
| `ANTHROPIC_API_KEY` | `""` | Direct Anthropic lane for Claude LLM nodes |
| `GEMINI_API_KEY` | `""` | Direct Google lane for Gemini models — see "Gemini routing" |
| `ELEVENLABS_API_KEY` | `""` | Speech, voices, dubbing |
| `ELEVENLABS_BASE_URL` | `https://api.elevenlabs.io` | Where ElevenLabs traffic goes — see 12a |
| `FAL_KEY` | `""` | fal.ai-hosted models |
| `HEYGEN_API_KEY` | `""` | AI Avatar / Cinematic Avatar (or run them on the nodaro.ai connection) |
| `BEEBLE_API_KEY` | `""` | Relight & Switch |
| `APIFY_API_TOKEN` | `""` | Web Scrape |
| `NODARO_API_KEY` | `""` | The nodaro.ai connection by key instead of OAuth (§11) |
| `NODARO_CLOUD_URL` | `https://app.nodaro.ai` | Where the connection talks to; CI points it at an unreachable host |
| `NODARO_ENCRYPTION_KEY` | `""` (compose: generated) | 64-char hex; encrypts pasted provider keys and social connections at rest |
| `HEYGEN_CATALOG_REFRESH_HOURS` | `24` | How often the shared HeyGen preset catalog is refreshed |
| `REPLICATE_WEBHOOK_SECRET` | `""` | Cloud edition — LoRA training callbacks; unset = webhook fast-fails 503 |
| `R2_ENDPOINT` · `R2_FORCE_PATH_STYLE` · `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `R2_BUCKET_NAME` · `R2_PUBLIC_URL` | bundled MinIO | Object storage — see 2d |
| `R2_REGION` | `auto` | S3 region. `auto` suits Cloudflare R2 and MinIO ignores it; set a real one for Supabase-local (`local`), DO Spaces (`nyc3`, …) or AWS — they reject `auto` |
| `STORAGE_OBJECT_ACL` | `""` (header omitted) | Canned ACL stamped on every uploaded object. For S3-compatible stores that cannot take a bucket policy — e.g. DO Spaces refuses `PutBucketPolicy` to a bucket-scoped key. See 2d |
| `R2_PUBLIC_FALLBACK_DOMAIN` | `""` | A second public host for assets (e.g. the raw `pub-<id>.r2.dev` beside a CDN domain) |
| `MAX_CONCURRENT_NODES_PER_EXECUTION` | `6` (max 20) | Nodes one workflow run may execute at once — the self-host parallelism ceiling |
| `VIDEO_WORKER_CONCURRENCY` | `50` | BullMQ concurrency of the media worker (I/O-bound) |
| `ORCHESTRATOR_CONCURRENCY` | `20` | BullMQ concurrency of the orchestrator (I/O-bound) |
| `RENDER_WORKER_CONCURRENCY` | `2` (max 10) | Remotion renders in parallel — each is a headless Chrome |
| `REMOTION_CONCURRENCY` | Remotion default (50 % of cores) | Browser tabs per render |
| `FFMPEG_CONCURRENCY` | `4` (max 32) | Concurrent ffmpeg processes across every ffmpeg node |
| `MCP_PUBLIC_URL` | `""` = the Nodaro Cloud host | Public base of the MCP host when it differs from `PUBLIC_URL`; self-hosters serving MCP on their main host set it equal to `PUBLIC_URL` |
| `MCP_DYNAMIC_REGISTRATION` · `MCP_DCR_ALLOWLIST` | off · `""` | RFC 7591 dynamic client registration for MCP clients, and its allowlist |
| `COMMUNITY_CONNECT_ENABLED` | off | **Cloud side only** — accept community-instance connections |
| `PLATFORM_OWNER_EMAIL` | `""` | Business/Cloud — the super_admin no other admin can demote; empty = none |
| `PLATFORM_OPERATOR_EMAILS` | `""` | Comma-separated emails allowed to reach the **money** admin routes (credit grants, tier/role changes, model pricing and cost settings) on a deployment that sets `billing.payerAccount`. Those routes additionally require a non-federated account, so an identity the deployment's own SSO provider asserts can never reach them. Empty falls back to `PLATFORM_OWNER_EMAIL`; empty with no owner closes the money routes to everyone. Inert on deployments with no payer account. |
| `EXTERNAL_SSO_PROVIDERS` | `""` (SSO off) | Trusted external identity providers, as inline JSON or `@/path/to/file.json`. Unset ⇒ no SSO button, `/v1/sso/*` 404s. A malformed value **fails the boot loud** (never silently disables auth). Shape + linking rules: [External SSO](./sso.md) |
| `EXTERNAL_SSO_LINK_EXISTING` | `false` | Whether a verified-email assertion may link to a **pre-existing** account not already SSO-linked. Default `false` is takeover-safe; `true` links only when the IdP also asserts a verified email. See [External SSO](./sso.md#account-linking-rules) |
| `KIE_UNIQUE_ID` | `""` | Cloud — KIE account id for the credit audit |
| `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` | `""` | Cloud only — billing; ignored on community/business |
| `PAYG_WEB_BLOCK_ENABLED` · `PAYG_WEB_BLOCK_EXEMPT_USER_IDS` | off · `""` | Cloud only — pay-as-you-go web block and its grandfathered accounts, comma-separated |
| `AUTO_RECHARGE_ENABLED` | off | Cloud only — auto-recharge kill switch (§10) |
| `ORGS_ENABLED` | off | Cloud only — multi-tenant organizations (schools / teams) rollout gate. Ships dark; the schema migrations run in every edition regardless |
| `MCP_ENABLED` | off | Serve the MCP endpoint (§10) |
| `COPILOT_ENABLED` | off | Cloud only — the in-app [Workflow Copilot](./features/workflow-copilot.md). Needs `ANTHROPIC_API_KEY`; admins can also pause it at runtime from Settings |
| `CHARACTER_LORA_ROUTING_ENABLED` | on | Route generations that mention a trained character through its LoRA; off = plain reference-image injection |
| `JOB_HOLD_TTL_HOURS` | `""` (holds never expire) | Only matters on a deployment that registers a **job policy** (see "Job policy" under Surface profile). Hours a job may wait in `pending_review` before the platform **auto-rejects** it: the reservation is refunded, the withheld output is deleted, and the decision is recorded with `policy_id = "platform"`, `reason = "hold-expired"`. The message the owner is left with is checked against what the refund actually moved — if nothing was still reserved it says so rather than promising credits back, and an operator report is filed. Unset = a held job waits for a human indefinitely, with its credits reserved the whole time. This is the one sweep allowed to touch a `pending_review` row. Auto-approve is deliberately not an option — it would publish exactly the output a human declined to look at |
| `META_APP_ID` … `DISCORD_CLIENT_SECRET` | `""` | Social network OAuth apps — see 2b-2 |

### 2b. Generate internal secrets

**On the community compose stack both are generated on first boot** and
persist in the `app-data` volume — skip this step. On a managed deployment
(Railway, your own orchestration), set both, 32 bytes hex each:

```bash
echo "INTERNAL_ORCHESTRATOR_SECRET=$(openssl rand -hex 32)" >> .env
echo "NODARO_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
```

`INTERNAL_ORCHESTRATOR_SECRET` authenticates the orchestrator process to
the API server within a Nodaro container. `NODARO_ENCRYPTION_KEY` is
AES-256-GCM key material used to encrypt stored credentials at rest —
social-OAuth tokens and in-app provider keys (§12). `SOCIAL_ENCRYPTION_KEY`
is the older name for the same variable and still works (see §8).

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

For any other S3-compatible store (AWS S3, Backblaze B2, DigitalOcean
Spaces, Supabase Storage, self-managed MinIO), set `R2_ENDPOINT` to its
S3 API URL, `R2_FORCE_PATH_STYLE=true` for most self-hosted servers, and
`R2_PUBLIC_URL` to the bucket's public URL.

Also set **`R2_REGION`** unless the store is Cloudflare R2 or MinIO. It
defaults to `auto`, which is R2's own value and which MinIO ignores — but
AWS, DO Spaces (`nyc3`, `fra1`, …) and Supabase-local (`local`) validate
the region and reject `auto`, so every request fails with an authorization
or endpoint error that does not mention the region at all.

**Making media publicly readable.** There are two mechanisms, and most
installs need only the first:

1. **A bucket policy** — the default. On a custom `R2_ENDPOINT` the app
   creates the bucket at boot and applies an anonymous-read policy to it, so
   objects are readable without any per-object header. Cloudflare R2 does not
   need this (its public bucket setting covers it), and Nodaro Cloud
   deliberately sends no ACL at all.
2. **`STORAGE_OBJECT_ACL`** — for stores that cannot take a bucket policy.
   DigitalOcean Spaces is the usual case: it refuses `PutBucketPolicy` to a
   bucket-scoped key, so per-object ACLs are the only way. Set
   `STORAGE_OBJECT_ACL=public-read` and every object this app writes carries
   that ACL.

Leave it empty unless you need mechanism 2. Empty means the header is omitted
entirely, which is the behaviour every existing install already has — setting
it on a store that is already public via policy is redundant, and setting it
on a store whose keys lack `s3:PutObjectAcl` will make every upload fail.
Accepted values are the standard canned ACLs (`private`, `public-read`,
`public-read-write`, `authenticated-read`, `aws-exec-read`,
`bucket-owner-read`, `bucket-owner-full-control`); anything else is rejected
at boot rather than on the first upload.

If the Cloud Recast plugin is enabled, its revisioned audio player loads
audio-only layer files directly in Web Audio. The public storage origin must
allow anonymous cross-origin `GET` from the Recast web origin (and `HEAD` when
your player or CDN uses it), expose the headers needed for media reads, and
honor byte-range requests (`Range` / `206 Partial Content`) so seeking works.
Configure this on the bucket or CDN, and verify it against an actual generated
audio-layer URL; API `CORS_ORIGIN` does not configure object-storage CORS.

### 2e. Start the stack

```bash
docker compose -f docker-compose.community.yml up
```

The app image is **pulled prebuilt** (`ghcr.io/nodaroai/nodaro-community`),
so first boot downloads ~2.4 GB rather than compiling for 5–10 minutes;
subsequent boots are seconds. (Set `NODARO_IMAGE` or use
`docker compose build` to build from source instead.) Besides `latest`
(which tracks `main`), every release is also tagged `v<X.Y.Z>` and `v<X.Y>`
— the version the app sidebar shows — so
`NODARO_IMAGE=ghcr.io/nodaroai/nodaro-community:v1.23.0` pins a
reproducible install. You'll see logs from
Redis and the `nodaro` service interleaving.

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
| Admin-configurable credit pricing | no | no | yes |

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

**The build refuses an empty or unknown `VITE_EDITION`.** Because Vite inlines
the value, an unset one would otherwise build cleanly and silently fall back to
`community` — a Business or Cloud image would ship with no admin panel and no
billing, and nothing would say so until someone went looking for them. The
compose file passes it for you; a hand-rolled `docker build` needs
`--build-arg VITE_EDITION=community|business|cloud`.

Three frontend values are **not** frozen at build time: the API origin, the
browser-facing Supabase URL and the anon key. At boot the container writes
them from its env into `/config.js` (`PUBLIC_URL`, `FRONTEND_SUPABASE_URL`
— defaulting to `PUBLIC_URL/supabase` on the bundled stack — and
`SUPABASE_ANON_KEY`), and the browser reads that file before the app
starts. So the published image serves any port or domain after a restart;
the `VITE_*` build args are only the fallbacks when a runtime value is unset.

Other build-time frontend env vars (all `VITE_*`, all inlined by Vite at
build time):

| Var | Description |
|---|---|
| `VITE_STUDIO_URL` | Base URL of the external Studio app (studio.nodaro.ai) for "Open in Studio" deep links. Default `https://studio.nodaro.ai`. |

## Surface profile (`NODARO_SURFACE_PROFILE`)

**Business and Cloud editions only.** The Community edition ignores
`NODARO_SURFACE_PROFILE` entirely and always serves the stock surface — set
`EDITION=business` (or `cloud`) to use it.

Set `NODARO_SURFACE_PROFILE` to inline JSON or `@/path/to/profile.json` to narrow
the UI without a rebuild: hide nav entries and dashboard tabs, deny node and model
types, set the product name, sibling-app links and login methods, pin a default
locale, and force outputs private. It rides the same `/config.js` channel as the
values above (env → validated at boot → mirrored to the browser); a
malformed/unreadable value degrades to the stock surface with a warning and never
blocks boot. Unset = the full default surface. The profile can only **narrow** —
it never turns on a surface the edition gates off. Fields (all optional; each
array empty = "keep the default"):

- `nav.hide`: `["gallery","explore","pricing","templates","apps","community","integrations"]`
- `dashboard.tabs`: one ordered whitelist governing **both** dashboard tab groups —
  the workspace strip (`workflows`, `projects`, `studio`) and the app-discovery
  strip (`apps`, `miniapps`, `templates`, `tutorials`, `statistics`). Each group
  renders the intersection of this list with its own tabs, in the list's order.
  An app-discovery strip whose intersection is empty is not rendered at all; the
  workspace strip instead falls back to all of its tabs when the list names none
  of them (the dashboard's main list can never go blank). So list every tab you
  want to keep across both strips — e.g. `["workflows","projects","statistics","tutorials"]`
  keeps the flat-workflows and projects workspace tabs (hiding the Studio list)
  and trims the app-discovery strip to Statistics and Tutorials. Full key set:
  `["workflows","projects","apps","miniapps","templates","tutorials","statistics","gallery","studio"]`
- `nodes.deny` / `models.deny`: node types / model ids to remove everywhere — the
  picker, `GET /v1/nodes`, `GET /v1/models`, the MCP tools, and at run time (a
  denied node fails with `node_not_available`)
- `nodes.allow` / `models.allow`: WHITELISTS — when non-empty, ONLY the listed
  node types / model ids are offered (then `deny` still subtracts). The safer,
  recommended shape for a curated deployment: a new platform node or model is
  unavailable until the deployment lists it, instead of available by omission.
  The inversion is scoped to gateable ids — utility nodes (`sticky-note`,
  `preview`) and workflow-internal pseudo-types are never denied by omission,
  only by an explicit `deny` entry. An admin can further adjust availability at
  runtime from **Admin → Availability** (full list with per-item toggles); a
  stored runtime override replaces this factory set until "Reset to factory".
- `auth.methods`: `["email","google","sso"]` (plus `auth.ssoLabel`)
- `siblings.apps`: `[{ "label": "...", "url": "..." }]` — replaces the Nodaro
  family links in the product switcher
- `brand.productName`: replaces the wordmark and the document title (absent =
  the static `<title>` shipped in `index.html` is left untouched)
- `brand.wordmark`: short lockup text rendered **beside your own logo mark** in
  the sidebar header — for a deployment that ships its own `/logo-*.svg` files
  and wants a tile+text lockup (e.g. productName `"Acme Studio"` with wordmark
  `"Studio"`). Absent = a custom-branded install keeps the text-only header.
  `productName` still drives the document title and accessibility name.
- `brand.description`: replaces the `<meta name="description">` (absent = the
  built-in default is kept)
- `locale.default` / `locale.picker`
- `outputs.allowPublic`: `false` forces every output private regardless of the
  user's preference
- `voice.allowedGenders`: `["male"]` / `["female"]` / `["neutral"]` (any subset) —
  restrict voice pickers, policy-owned default voices, and TTS / speech requests to
  these voice genders. Empty (`[]`) = all genders. Enforced backend-side: the
  `/v1/voices` list and the ElevenLabs shared-voices library are filtered (and the
  library query gender is forced to the allowed set), a premade voice of a
  disallowed gender is refused at request validation with `voice_not_available`,
  every default/fallback voice resolves to the first allowed-gender voice, and the
  Suno vocal-gender tags in the editor hide the disallowed side. Pair with
  `nodes.deny: ["voice-clone","voice-design","voice-remix"]` to remove the
  voice-creation nodes (whose output gender is not knowable up front).
- `features` — whole features this deployment switches off:
  `{"features":{"hide":["copilot","presentation"]}}`. `copilot` removes the
  Workflow Copilot everywhere — the canvas rail and its collapsed tab, the
  toolbar button and its ⌘J shortcut, the dashboard composer — and the backend
  answers its routes with the same 503 the client already handles.
  `presentation` hides the canvas **Present** tab. Share links and published
  apps that already exist keep working; what goes with the tab is the only UI
  for *minting* a new share link or publishing a workflow as an app or
  template, so hide it only where that is intended. Empty (the default)
  inherits everything the code renders.
- `billing` — the billing display surface (a dedicated hosted instance meters
  in the platform's credits but shows its customer's own unit):
  - `billing.unitLabel` + `billing.unitRate` (+ optional `billing.unitDecimals`,
    0–4, default 0): relabel and convert every credit figure — the Cost tab,
    the usage page, the sidebar balance, canvas estimates, and the `unit` field
    the billing routes emit. `unitRate` = display units per 1 credit. The three
    are validated as a unit and dropped together (with a warning) when
    incoherent: label and rate must both be set; the rate must be a finite
    number > 0; decimals an integer in 0–4; 1 credit must not round to 0; and
    `unitRate × 10^unitDecimals` must be an integer so per-charge conversion
    sums exactly. Unset = the platform's own labels, no conversion.
  - `billing.costTab`: `"hidden"` keeps the canvas Cost tab off even with a
    billing provider registered (default `"inherit"`).
  - `billing.sidebarCard`: `"hidden"` removes the sidebar credit-balance card
    (default `"inherit"`) — for a prepaid instance whose users read balances on
    the usage page instead of an always-on readout.
  - `billing.selfServe`: `false` withholds self-serve purchase — the pricing
    page, buy-packs, `/billing` and every "buy credits" call to action — for a
    prepaid instance whose users must not buy the platform's credits with a
    card (default `true`; a present `false` is never flipped open). A prepaid
    billing instance renders a **Usage & Cost** sidebar entry (`/usage`) in
    their place.
  - `billing.payerAccount`: the **deployment payer** — one designated account
    (a user uuid, or the account's email) that pays for *every* action on the
    instance instead of the requester. For reseller-style deployments: the
    operator tops up this one prepaid account; end users hold no credit
    balance of their own — only, optionally, a per-user *allowance* drawn
    from the payer's account (see `billing.defaultAllowanceUnits` below).
    Consequences when set: every reservation debits the payer account
    (ownership and galleries stay the requester's); requester tier gates run
    at the payer account's grade, with watermarking and daily caps off;
    per-user storage quotas stop enforcing (usage is still tracked); the
    payer is never auto-recharged; and `/usage` shows each user their own
    consumption for the period, plus their own allowance when the allowance
    keys are configured — never the payer's balance. The value is
    backend-only: it is stripped from `/config.js`, and the browser learns
    only a boolean `deploymentPayer` flag from `GET /v1/billing/surface`.
    The payer account gets a **billing page** (`/billing-admin`) that no
    other account can reach: it shows the pool, the per-user allowances and
    the grant history, and — when `STRIPE_SECRET_KEY` and
    `STRIPE_WEBHOOK_SECRET` are set (see the variable table above) — lets the
    payer load credits with its own card. Without those two the page still
    works and simply reports that card payment is not configured.
    **Fail-loud:** if set but the account does not resolve at boot, the
    instance refuses to start. Unset = requesters pay, exactly as before.
  - `billing.defaultAllowanceUnits`: the starting allowance every user gets,
    in display units — the per-user ceiling on how much of the payer's pool
    one person may spend. **Seed only:** it is written to the deployment's
    billing settings on the FIRST boot that creates them, and never again;
    afterwards only the billing account changes it, from `/billing-admin`.
    A member of the unit family — it needs a coherent `unitLabel` +
    `unitRate`, drops with them, and `defaultAllowanceUnits / unitRate` must
    be a whole number of credits (the ledger stores platform credits) or the
    key drops with a warning. Payer-only and backend-only: meaningless
    without `billing.payerAccount`, and stripped from `/config.js`.
  - `billing.allowances`: `"off"` (the default, and what an absent or
    malformed value means) or `"enforce"`. **This is the enforcement flag —
    the gate-check for this feature.** Allowances are *visible* on `/usage`,
    the sidebar, the admin user list and `/billing-admin` as soon as a payer
    is set; `"enforce"` is what additionally lets a reservation refuse a run
    that is over allowance (HTTP 402 `user_allowance_exceeded` — see
    [api-integration.md](./api-integration.md#8-error-envelope)). Roll it out
    in that order: set the payer and the default, let the figures appear and
    be checked, then flip. Also a member of the unit family — a deployment
    that cannot display an allowance will not enforce one. Payer-only,
    backend-only, stripped from `/config.js`.

Example:

```bash
NODARO_SURFACE_PROFILE={"nav":{"hide":["gallery"]},"brand":{"productName":"Studio"},"outputs":{"allowPublic":false},"voice":{"allowedGenders":["male"]},"billing":{"unitLabel":"credits","unitRate":2000,"selfServe":false,"defaultAllowanceUnits":100000,"allowances":"off"}}
```

**Prompt policy (modesty / content clauses).** A deployment that needs to fold a
fixed clause into every image / video / audio prompt (or force the Suno vocal
gender) registers a backend `PromptPolicy` at the composition root — it is applied
server-side, after prompt assembly, so a client cannot bypass it. This is **code
the deployment owns, not an environment variable**; with none registered, prompt
assembly is byte-identical to stock. (There is deliberately no env-var switch for
the clause — the clause text is the deployment's own, kept out of the shipped
packages rather than read from the environment.) The clause lives in the
deployment's own registered `PromptPolicy` module, applied by the backend
registry in `backend/src/lib/prompt-policy.ts`; the published `@nodaro/prompts`
package stays content-free, enforced by its `content-free-contract` guard test
(the package source may not read `process.env`).

**Job policy (generation gates).** A deployment that must judge generations —
before they run, or before their output is published — registers a backend
`JobPolicy` at the composition root (`backend/src/lib/job-policy.ts`). Like the
prompt policy it is **code the deployment owns, not an environment variable**, and
with none registered the platform is byte-identical: the funnels short-circuit
before any check and before any audit write. One policy object carries two
optional checks. The **request** gate (`checkRequest`) sits at the single
job-insert funnel and is asked before a row or a credit reservation exists; its
verdict is `{ verdict: "allow" }` or `{ verdict: "block", reason, userMessage? }`,
and a block answers HTTP 422 `{ error: { code: "job_blocked", message } }` with
nothing to refund. The **result** gate (`checkResult`) sits at the completion
funnels, asked after the output is written to storage and before the completion
write, the asset row and the credit commit; its verdicts are `allow`, `flag`,
`block` and `hold`. A `block` fails the job with a full refund, deletes the
produced object and writes a structured `error_hint` (`kind: "policy-block"`); a
`hold` parks the job in the `pending_review` status — an in-flight status,
exempt from the reconcile and timeout sweeps, output withheld, credits still
reserved — until an admin approves it onto the normal completion path or rejects
it, from **Admin → Review** (`/v1/admin/review/jobs…`). Both gates are
**fail-closed** once a policy is registered: a check that throws never publishes —
the request gate blocks, the result gate holds when the job is hold-eligible and
blocks otherwise, recorded with `reason: "policy-unavailable"` and a
platform-owned user message, never the policy's own wording. A job row the
result gate cannot read is treated the same way: the read is retried once and
then blocks (never holds — eligibility is a property of the row it could not
read), while only a confirmed missing row answers allow. Every decision,
`allow` included, is recorded in `job_policy_decisions` keyed by
`(job_id, hook_point, payload_hash)`, which is also the idempotency key: queue
retries and the reconcile cron reuse a recorded result-gate verdict instead of
re-asking the deployment's gate. (`job_id` is NULL for a request-gate block — no
row exists to point at — so the reuse guarantee is a result-gate one; a repeated
request is a repeated decision.) `JOB_HOLD_TTL_HOURS` bounds how long a hold may
wait. Design note: [`docs/design/job-policy-seam.md`](design/job-policy-seam.md).

Brand **assets** (favicon, logos) are overridden by a Docker static-asset layer,
not this JSON.

## 6. Updating

Pull the newer image and restart:

```bash
git pull
docker compose -f docker-compose.community.yml pull
docker compose -f docker-compose.community.yml up -d
```

(Building from source instead? Swap `pull` for `build`.)

Rolling back is pinning the previous version: releases are tagged
`v<X.Y.Z>` / `v<X.Y>` alongside `latest`, so point `NODARO_IMAGE` at the
last good tag and `up -d` again.

On the bundled stack, migrations apply **automatically on boot**
(`RUN_MIGRATIONS_ON_BOOT`, §2c) — there is nothing to run by hand. Only
when pointing at your own managed Supabase project with boot migrations
disabled do new files under `supabase/migrations/` need applying in
filename order before restarting; the backend won't crash on a missing
migration, but specific routes will 500 until their schema lands.

We aim to keep migrations forward-compatible (new tables, additive
columns) — if anything changes destructively, it'll be called out in
the changelog. Pin to a specific commit/tag if you need to be cautious.

### VM deploy lane

To keep a self-hosted VM install updated over SSH, copy
[`examples/deploy-host.yml`](../examples/deploy-host.yml) into your own
repository's `.github/workflows/`, set the `DEPLOY_HOST`, `DEPLOY_USER` and
`DEPLOY_SSH_KEY` secrets, and dispatch it. It reuses the published community
image tag, runs `docker compose pull && up -d`, health-gates on `/health`, then
prunes old layers. Never trigger production deploys on a branch push, and use
separate secret names per environment. It ships as an example, not a workflow in
this repo — there are no deploy secrets where the public mirror runs.

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

**Two installs, one database**: if you point a second install (a
staging copy, a preview environment) at the SAME Supabase project but
give it its OWN Redis, name each install with `RUNTIME_ENV` — on
Railway `RAILWAY_ENVIRONMENT_NAME` already does this for you. Workflow
executions record the name of the install whose orchestrator claimed
them, and each install's stale-execution sweeps only reconcile its own.
Without distinct names, each install looks for the other's
orchestration jobs in its own Redis, fails to find them, and marks
perfectly healthy runs failed with "Execution orphaned". Rows already
running at the moment you upgrade carry no name yet; the install named
`production` reconciles those.

**Redis HA**: BullMQ supports Redis cluster mode out of the box. Set
`REDIS_URL` to a cluster endpoint or a Sentinel URL.

**Shared caches on Redis (multi-instance API)**: besides the queues,
the API keeps small shared snapshots in Redis so N API containers do
not each redo the same slow provider work — today the HeyGen avatar /
voice catalogs (`heygen:catalog:v1:*`, ≈4 MB, published once a fill
completes and adopted by every instance at boot; one instance per
environment refreshes it under a lock every
`HEYGEN_CATALOG_REFRESH_HOURS`, default 24; the others notice a newer
snapshot within about half a minute and adopt it). Everything there is a
cache: with Redis unreachable each instance falls back to its own
memory, and a flushed key is simply refilled from the provider on the
next boot.

**Object storage**: configure bucket-level lifecycle rules on R2/S3 to
expire old assets (e.g. 90 days). Nodaro never deletes assets itself —
it only references them by key. One exception: on Cloud, a daily cron
reaps transient `video-analysis-tmp/` intermediates (analysis working
files, orphaned after a worker crash). Self-hosted (Community/Business)
deployments have no such cron, so include the `video-analysis-tmp/`
prefix in your bucket lifecycle rule.

## 8. Backups

**Compose (community quickstart) installs — one command each way:**

```bash
tools/community-backup.sh              # -> backups/nodaro-backup-<date>-<version>.tar.gz
tools/community-restore.sh <archive>   # DESTRUCTIVE; asks for confirmation
```

The backup holds the Postgres dump, the MinIO media, the instance
encryption key and `.env` — everything the stack cannot regenerate.
Restore is also the **downgrade path**: migrations are forward-only, so
going back a version means restoring the backup taken before the upgrade.
Take one before every major-version update.

**Managed deployments** — three things are stateful:

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
- **The instance encryption key** — everything the server stores for
  itself (provider keys pasted on `/setup`, social OAuth tokens) is
  AES-256-GCM encrypted with it. On the community compose stack it is
  generated on first boot and lives in the `app-data` volume at
  `/data/nodaro/encryption-key`; on a managed deployment it is the
  `NODARO_ENCRYPTION_KEY` variable. **Back it up together with Postgres** —
  a database restore without the matching key gives you rows nobody can
  read (the tiles show `missing` and the keys must be re-entered; nothing
  else breaks).

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

**`port is already allocated` on `docker compose up`.** Only two host
ports are published — 3000 (app) and loopback 9001 (MinIO console); Redis
and the database never bind one. Change the host side of the conflicting
mapping (`"3001:3000"`) and, for the app port, set `PUBLIC_URL` to match —
same fix as the [quickstart](./community-edition-quickstart.md).

**Frontend renders, but the editor stays blank or "Loading…" forever.**
Open the browser console. If you see CORS errors, set `CORS_ORIGIN` to
your real public URL and restart. If you see Supabase auth errors, open
`/config.js` on your install: it must name the Supabase URL your browser can
reach (on the bundled stack `PUBLIC_URL/supabase`) and the anon key. It is
written at boot from `PUBLIC_URL` / `FRONTEND_SUPABASE_URL` /
`SUPABASE_ANON_KEY` — fix those and restart.

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
| `gemini-3.7-flash` | KIE | KIE fails |
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

## 12. Provider keys: paste on /setup, or set in the environment

Self-host editions take provider keys two ways, and both are live at once:

| Way | Where it lives | Takes effect | Who may change it |
|---|---|---|---|
| **Paste in the app** — `/setup` → Install health (setup time, pre-login) or **Integrations → Model providers** (in the app); both use `PUT /v1/setup/provider-keys/:id` | `provider_credentials` table, AES-256-GCM with the instance key; never returned by any route | Immediately in the API process. The worker re-reads the store on a poll (~30 s) — and a Run that lands before the poll is not refused: a route that finds no provider re-reads once and re-routes (the router self-heal), so "paste, then Run" works. No restart. | Community: any signed-in user (single operator by design). Business: admins. Always a first-party session — never an API/app token. |
| **Environment** (`KIE_API_KEY`, `REPLICATE_API_TOKEN`, …) | `.env` / the platform's variables | On start | Whoever manages the deployment |

**Precedence: environment wins.** A key set in the environment is read-only
on the screen — the tile shows `set (env)` and names the variable to remove.
Pasted keys fill in only where the environment is empty.

The full list of provider keys is `PROVIDER_KEY_IDS` in
`backend/src/lib/provider-keys-runtime.ts` (nodaro.ai, KIE.ai, Replicate,
Anthropic, Google Gemini, ElevenLabs, fal.ai, HeyGen, Beeble, Apify) — the
tiles, the `.env` template and `GET /v1/setup/status` all derive from it.
Provider code reads keys per call, so a change is picked up everywhere;
`tools/check-provider-key-captures.mjs` (CI) fails on a construction-time
capture that would freeze a key.

Requires the instance encryption key (section 8). Without one, tiles report
`missing` and `/setup` shows a red **Encryption** card with the fix.

### 12a. Sending provider traffic through your own proxy

Two providers let you move the *host*, not just the key:

| Variable | Default | Moves |
|---|---|---|
| `KIE_API_BASE_URL` | `https://api.kie.ai` | Every KIE call — media generation **and** the KIE-fronted LLM lanes |
| `ELEVENLABS_BASE_URL` | `https://api.elevenlabs.io` | Every ElevenLabs call — TTS, STT, voices, cloning, dubbing, forced alignment |

Leave both unset and nothing changes: the defaults are the vendors' own
hosts, so an install that never touches these makes byte-identical requests
to the ones it made before the variables existed.

Set one and Nodaro talks to your host instead. The usual reasons are key
custody (the real vendor key lives on the proxy, never in the app's
environment), audit logging of every outbound generation, and regional
routing. Your proxy is expected to be transparent — same paths, same
request and response bodies — because Nodaro only substitutes the origin.
Trailing slashes are stripped, so `https://proxy.example.com/kie/` and
`https://proxy.example.com/kie` behave identically.

**`KIE_API_BASE_URL` also reroutes LLM traffic.** This is the part that
surprises people. KIE is not only a media provider here — the Claude and
Gemini lanes that power prompt enhancement, script generation, the workflow
copilot and the pipeline stages are served over the same host. Overriding it
therefore sends those through your proxy too, which is usually what you want
(one audit point for everything) but means the proxy must handle more than
the media API: it needs `/api/v1/...` (task creation and polling — this also covers the
`/api/v1/chat/credit` balance probe), `/claude/v1/messages`,
`/<family>/v1/chat/completions`, `/<family>/v1/responses`, and
`/client/v1/userRecord/...` (the per-task credit lookup behind the admin
credit audit). A proxy that forwards only the media paths will
leave every LLM-backed feature failing while image and video generation keep
working — a confusing state worth ruling out first.

Direct-lane keys are unaffected: set `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`
and those models leave KIE entirely, proxy or no proxy (see "Gemini
routing").

## See also

- [Community Edition Quickstart](./community-edition-quickstart.md) —
  shorter, opinionated version of this guide
- [Architecture](./architecture.md) — how the pieces fit together
- [Edge modes](./edge-modes.md) — request flow, auth, edition gates
- [API Integration](./api-integration.md) — once you're up, talk to
  your instance from your own server
