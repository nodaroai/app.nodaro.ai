# Backend — Claude Code Reference

## Edition Architecture (`backend/src/ee/`)

The `backend/src/ee/` directory holds enterprise code (admin routes, billing/credit infrastructure, Stripe integration). It is governed by the Nodaro Enterprise License (`backend/src/ee/LICENSE`) — production use requires a Nodaro Cloud or Enterprise subscription.

**Folder layout under `ee/`:**
- `ee/routes/` — admin-* routes (12), billing routes (4), monetization route
- `ee/billing/` — credits service, Stripe client/config, provision-credits, cleanup-cron, credit-anomaly
- `ee/middleware/` — `require-admin.ts`
- `ee/services/credits.ts` — re-export shim for CreditsService types/methods
- `ee/lib/credit-guard-impl.ts` — heavy creditGuard implementation, dynamic-loaded by core shim

**Core/ee boundary rules:**
1. **Core may NOT statically import from `ee/`.** Enforced by `tools/check-ee-imports.mjs` in CI.
2. **Two permanent allowlist exceptions:** `app.ts` (route registration) and `server.ts` (cleanup cron startup). Both gate the imports with `hasAdmin()` / `hasCredits()` at registration time.
3. **Shim pattern for hot-path code:** `middleware/credit-guard.ts` stays in core with thin dispatcher functions. Heavy logic in `ee/lib/credit-guard-impl.ts` is loaded via dynamic `import()` only when `hasCredits()` is true. Same pattern for `workers/shared.ts` credit operations.
4. **`*.ee.<ext>` filename suffix** is reserved for in-place enterprise variants of core files (e.g., `cost-tab.tsx` + `cost-tab.ee.tsx`). Per the Enterprise License, the `.ee.` substring in a filename makes it enterprise regardless of extension. Use the `ee/` directory by default; the suffix is only for tight coupling with a core sibling.
5. **Edition gates in `app.ts`:** admin routes register only when `hasAdmin()`; billing/credits/monetization routes register only when `hasCredits()`.

**Phase 3.5 / Phase 4.5 deferred work:** ~26 backend files + ~98 frontend files currently statically import from `ee/` for pricing data, model registries, or React hooks. They are pre-existing coupling marked `TODO Phase 3.5/4.5` in the allowlist; converting them to dynamic-require shims (or extracting shared data to core) is a separate cleanup pass.

---

## Credit System Pattern

Credits are handled via middleware, NOT inline in route handlers:
```typescript
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

app.post("/v1/my-route", {
  preHandler: creditGuard((req) => {
    const body = req.body as Record<string, unknown>
    return (body?.provider as string) ?? "default-provider"
  }),
}, async (req, reply) => {
  const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
  if (reply.sent) return
  const usageLogId = reservation?.usageLogId
})
```

**Credit files (cloud edition — under `ee/`):**
- `ee/billing/credits.ts` — `CreditsService` class, RPC wrappers, model pricing cache
- `ee/billing/stripe-config.ts` — `TIER_CREDITS`, `TIER_STORAGE_LIMITS`, `TIER_PARALLELISM`, Stripe price IDs
- `ee/billing/stripe-client.ts` — Stripe SDK client
- `ee/billing/provision-credits.ts` — webhook event handlers (subscription created/updated/deleted, charge.succeeded)
- `ee/billing/cleanup-service.ts` + `ee/billing/cleanup-cron.ts` — R2 media cleanup, expire subscriptions
- `ee/billing/credit-anomaly.ts` — `computeActualCredits` + `checkAndLogAnomaly` for anomaly detection
- `ee/services/credits.ts` — re-export shim for `CreditsService` types/methods
- `ee/routes/billing.ts`, `ee/routes/credits.ts`, `ee/routes/credits-balance.ts`, `ee/routes/stripe-webhook.ts` — public billing/credit routes
- `ee/lib/credit-guard-impl.ts` — heavy credit-guard implementation (storage check + credit reservation)

**Core shim (stays in `middleware/`):**
- `middleware/credit-guard.ts` — thin dispatcher; `creditGuard()` returns no-op preHandler when `!hasCredits()`, otherwise delegates to `ee/lib/credit-guard-impl.ts` via dynamic `import()`. The 62 routes calling `creditGuard()` see no behavioral change.

---

## CORS Configuration
- Backend CORS in `backend/src/app.ts`: whitelist `http://localhost:3000`, `https://app.nodaro.ai`, plus `CORS_ORIGIN` env var (comma-separated)
- SSE responses validate origin against the same allowlist (in `sse.ts`) because `reply.raw.writeHead()` bypasses Fastify's `onSend` hooks

---

## Auth Middleware (`middleware/auth.ts`)

- `registerAuthHook(app)` — Fastify preHandler: extracts Bearer token, verifies via Supabase `auth.getUser()`, sets `req.userId` + `req.userRole`
- 5-minute token cache (keyed by SHA-256 hash of token) to avoid repeated Supabase queries
- Public route whitelist: gallery, gallery/items, gallery/report, download, download-video/progress, health, stripe-webhook, image-proxy, credits/model-cost, webhooks (prefix)
- `invalidateAuthCache(userId)` — clears cached token for a user
- Fallback: accepts `userId` in body/query (legacy migration path)

### Three auth modes

| Token shape | Source | req.userId | req.appAuthorization |
|-------------|--------|------------|----------------------|
| `eyJ...` (JWT) | Supabase user | yes | undefined (user is owner) |
| `ndr_app_...` | OAuth from developer app | yes (resource owner) | yes (`{ appId, authorizationId, scopes }`) |
| `ndr_...` | API token | yes | undefined (legacy) |
| `X-Internal-Orchestrator-Secret` header | Internal RPC | from body | undefined |

**Scope enforcement**: routes opt in via `requireScope(req.appAuthorization?.scopes ?? [], "workflows:read")`. When `appAuthorization` is undefined (Supabase JWT path or API token path), the scope check is a no-op — the user owns the resources. Currently 3 routes are gated:
- `GET /v1/projects/:projectId/workflows` — `workflows:read`
- `POST /v1/workflows/:id/run` — `workflows:execute`
- `GET /v1/jobs/:id` — `jobs:read`

**Resolution order** (in `auth.ts:registerAuthHook`): public route check → internal-secret header → `ndr_app_` OAuth token → Supabase JWT → reject with 401.

### Dynamic CORS

`backend/src/lib/dynamic-origins.ts` — async DB-backed origin allowlist with 60s in-process cache (stampede-safe). Combines:
1. Static origins from `getStaticAllowedOrigins()` (PUBLIC_URL + CORS_ORIGIN env)
2. `developer_apps.allowed_origins` for `status='active'` apps

Cache invalidated on dev-app create/update/delete. Both Fastify CORS (in `app.ts`, async-promise form — NOT callback-form, that double-fires) and SSE (`createSSEStream` in `sse.ts`, now async) consume `isOriginAllowedDynamic()`.

### Developer apps + OAuth routes

- `POST /v1/developer-apps` (JWT): create app; returns `clientSecret` ONCE in plaintext
- `GET/PATCH/DELETE /v1/developer-apps/:id` — owner CRUD
- `POST /v1/developer-apps/:id/rotate-secret` — invalidates old secret
- `POST /v1/oauth/authorize` (JWT): user clicks Allow, returns one-shot code (10-min TTL)
- `POST /v1/oauth/token` (public, client credentials): exchanges code for access token
- `POST /v1/oauth/revoke` (public, RFC 7009): always 200, no info leak
- `GET /v1/oauth/app-info?client_id=` (public): app metadata for consent screens

---

## AI Provider System

### Provider Registry File Structure
```
backend/src/providers/
  provider.interface.ts  — All capability interfaces (11 types)
  registry.ts            — Singleton ProviderRegistry
  ***REDACTED-OSS-SCRUB***
  router.ts              — 10 typed operation functions
  index.ts               — initProviders() + re-exports
  kie/
    client.ts            — KIE.ai HTTP client
    models.ts            — All KIE model configs (costs, durations, params)
    image.ts, video.ts, audio.ts, index.ts
  replicate/
    client.ts, image.ts, video.ts, index.ts
```

### Provider Capabilities

| Capability | KIE.ai | Replicate | Notes |
|------------|--------|-----------|-------|
| image-generation | Yes | Yes | KIE: + grok, gpt-image |
| image-editing | Yes | No | KIE only: recraft, nano-banana-edit |
| image-to-video | Yes | Yes | KIE: minimax, veo, kling, grok-i2v, sora2-pro + 11 new (seedance, wan-i2v, wan-turbo, hailuo-2.3-pro/std, hailuo-standard, sora2, bytedance-lite/pro/pro-fast, kling-master); Replicate: runway, pika |
| text-to-video | Yes | Yes | KIE: minimax, veo, kling; Replicate: runway, pika |
| video-to-video | Yes | No | KIE only (Wan 2.6) |
| motion-transfer | Yes | No | KIE only |
| video-upscale | Yes | No | KIE only (Topaz) |
| lip-sync | Yes | No | KIE only (kling-avatar, hailuo-avatar) |
| music-generation | Yes | No | KIE only |
| text-to-speech | Yes | No | v3 = direct ElevenLabs API; v2 models = KIE |

### Routing Logic
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***

### KIE.ai Models

***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
| Video | veo3 | $1.25 | 8s fixed | imageUrls[] |
| Video | veo3.1 | $0.30 | 8s fixed | imageUrls[] |
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***

### Model Identifiers (Case-Sensitive)
All use **lowercase with hyphens** except VEO which uses **dot notation**: `veo3`, `veo3.1` (NOT `veo-3` or `veo_3.1`)

### Duration Validation
- VEO3/VEO3.1: Fixed 8 seconds (no duration parameter)
- Kling/Kling-Turbo/Kling-Master: 5 or 10 seconds
- Kling 3.0: 3-15 seconds (3, 4, 5, 6, 7, 8, 9, 10, 15)
- MiniMax: Fixed 5 seconds
- Grok: 6 or 10 seconds
- Sora/Sora2-Pro: Uses `n_frames` (10 ~ 5s, 15 ~ 10s)
- Seedance: 4, 8, or 12 seconds
- Wan I2V: 5, 10, or 15 seconds
- Wan Turbo: Fixed 5 seconds
- Hailuo 2.3/2.3-Pro/Standard: 6 or 10 seconds
- Bytedance Lite/Pro/Pro-Fast: 5 or 10 seconds

### End Frame Support (Start + End Image -> Video)
- VEO3/VEO3.1: `imageUrls: [startFrame, endFrame]`
- MiniMax: `end_image_url` parameter
- Hailuo Standard: `end_image_url` parameter
- Bytedance Lite: `end_image_url` parameter
- Kling Turbo: `tail_image_url` parameter
- Others (kling, grok, sora2): Single image only

### Replicate Cost Tracking
- Uses `predictions.create()` + `replicate.wait()` (NOT `replicate.run()`)
- Rate: `predictTime * 0.000225` USD per second

### KIE.ai Integration
- Base URL: https://api.kie.ai, Auth: Bearer token (KIE_API_KEY)
- Standard: `POST /api/v1/jobs/createTask` + `GET /api/v1/jobs/recordInfo`
- VEO3: `POST /api/v1/veo/generate` + `GET /api/v1/veo/record-info`

---

## Credit System

### Dual-Pool Architecture
- `subscription_credits` — reset monthly at billing period
- `topup_credits` — never expire
- **Deduction order:** subscription first -> then topup
- `deduct_credits` RPC handles atomic deduction with FOR UPDATE lock
- Free tier: 250 credits, 50/day cap, veo3/sora2-pro blocked, outputs watermarked

### Pricing
***REDACTED-OSS-SCRUB***
- Tiers: Free ($0/250cr), Basic ($24mo/$19yr/475cr), Standard ($49mo/$39yr/1175cr), Pro ($99mo/$79yr/2650cr), Business ($189mo/$149yr/5600cr)
- Top-ups: $10/275cr, $25/750cr, $50/1650cr, $100/3500cr (never expire)

### Variable Credit Pricing (Composite Model Identifiers)
Some models cost different credits based on quality/resolution settings.
Composite identifiers use `:` separator: `{provider}:{setting_value}`.

| Model | Default | Higher Setting | Credits (default → higher) |
|-------|---------|----------------|----------------------------|
| gpt-image | medium | high | 2 → 7 |
| nano-banana-pro | 1K/2K | 4K | 6 → 8 |
| flux | 1K | 2K | 2 → 3 |
| flux-flex | 1K | 2K | 5 → 8 |
| ideogram | BALANCED | TURBO/QUALITY | 6 → 4/8 |

**Implementation:**
- Backend: `buildCreditModelIdentifier()` in `generate-image.ts` / `image-to-image.ts` builds composite ID from request body
- Frontend: `buildCreditModelIdentifier()` in `config-panels/helpers.ts` builds composite ID from node data
- `VARIABLE_PRICING_MODELS` in `model-options.ts` maps provider → which setting affects cost
- `STATIC_CREDIT_COSTS` in `credits.ts` has both base and composite entries

### Credit Cost Per Node

***REDACTED-OSS-SCRUB***

| Node Type | Credits | Notes |
|-----------|---------|-------|
| generate-script | 5 | Gemini Flash |
| generate-image | 1-8 | z-image=1, nano-banana=2, flux=2, grok=2, gpt-image=2 (medium) / 7 (high), nano-banana-pro=6/8, ideogram=4-8 |
| image-to-image | 2-8 | flux-pro-i2i=2/3, gpt-image-i2i=2/7, flux-i2i=5/8, ideogram variants=4-8 |
| edit-image | 0-2 | recraft-remove-bg=0, recraft-upscale/nano-banana-edit/topaz=2 |
| image-to-video | 10-125 | kling-turbo=10, minimax=25, kling=22, grok-i2v=19, veo3.1=40, veo3=125 |
| text-to-video | 10-125 | Same as image-to-video |
| text-to-speech | 4 | ElevenLabs v3 (default, direct API), Turbo v2.5 / Multilingual v2 (via KIE.ai); `stripAudioTags()` removes `[...]` for v2 |
| voice-clone | 5 | ElevenLabs instant voice clone (direct API) |
| generate-music | 7-13 | Suno v4=7, Suno v5=13 |
| text-to-audio | 4 | ElevenLabs SFX |
| ai-writer | 5 | Claude Sonnet via Anthropic API |
| lottie-overlay | 5 | Claude Sonnet → Lottie overlay plan |
| 3d-title | 15 | Claude Sonnet → 3D title plan (camera, lighting, text, particles) |
| voice-design | 5 | ElevenLabs `/v1/text-to-voice/design` (direct API), full controls: model, loudness, guidance, seed, quality, enhance |
| qa-check | 3 | Gemini Flash |
| render-video | 15 | Remotion cloud render |
| FFmpeg nodes | 0 | combine-videos, merge-video-audio, add-captions, resize, trim, extract-audio, mix-audio, adjust-volume |

### Credit Flow
1. Job created -> Reserve credits (estimate based on model)
2. Job processing -> API call to provider
3. Job completed -> Commit actual credits, refund difference if overestimated
4. Job failed -> Full refund to original pools (uses `from_sub`/`from_topup` from `usage_logs.metadata`)

### Watermark System (Free Tier)
- Free tier: semi-transparent "Nodaro.ai" watermark; paid tiers: clean outputs
- **Images**: Sharp SVG composite, bottom-right, font size = 2.5% of width (min 16px)
- **Videos**: FFmpeg `drawtext` filter, white@0.5 opacity, bottom-right
- **NOT watermarked**: audio, scripts, FFmpeg processing nodes
- Watermark decision stored on `jobs.should_watermark` at credit reservation time (prevents bypass via tier upgrade between reservation and processing)
- Worker reads `should_watermark` from the job record, NOT from `profiles.tier`
- Helpers in `backend/src/utils/watermark.ts`: `applyImageWatermark(buffer)`, `applyVideoWatermark(inputPath, outputPath)`
- Worker helpers in `workers/video-worker.ts`: `uploadImageMaybeWatermark`, `uploadVideoMaybeWatermark`, `watermarkLocalVideoAndUpload`
- Special case: image-to-video with audio merge -- watermark applied to FINAL merged output only

### Cost Markup (Cloud Edition)
***REDACTED-OSS-SCRUB***
- Regular users see `cost` (display_cost). Provider/provider_cost hidden via `sanitizeJobForPublic()`
- Admin users see full breakdown. Self-hosted: no markup, full data visible.

---

## Billing (Stripe — Cloud Edition only)

All billing code lives under `backend/src/ee/billing/` and `backend/src/ee/routes/`. It only registers when `EDITION=cloud` (gated in `app.ts` via `if (hasCredits())`).

### Billing Routes (`backend/src/ee/routes/billing.ts`)
- `GET /v1/billing/subscription?userId=...` — Current subscription
- `GET /v1/billing/transactions?userId=...` — Transaction history
- `POST /v1/billing/manage-subscription` — Stripe customer portal URL
- `POST /v1/billing/change-plan` — Change tier (`stripe.subscriptions.update()` with `proration_behavior: "always_invoice"`)

### Plan Change Flow (CRITICAL — avoids duplicate subscriptions)
- Subscribed users: pricing page calls `POST /v1/billing/change-plan` (NOT a fresh checkout)
- New users: pricing page redirects to Stripe Checkout to create first subscription
- Stripe sends `customer.subscription.updated` webhook automatically after plan change
- `handleSubscriptionUpdated()` in `ee/billing/provision-credits.ts` handles credit diff

### Cancellation Flow (CRITICAL — must downgrade immediately)
- `customer.subscription.deleted` webhook fires for BOTH immediate and end-of-period cancellations
- `handleSubscriptionCanceled()` ALWAYS downgrades to free tier immediately: `tier = "free"`, `subscription_credits = min(current, TIER_CREDITS.free)`, `storage_limit_bytes = 1GB`
- `expireSubscriptions` cron is a safety net only
- Topup credits are NOT affected by cancellation

### Webhook System
- Endpoint: `POST /v1/billing/stripe-webhook` (in `backend/src/ee/routes/stripe-webhook.ts`)
- **Webhook URL must match deployment**: `https://{domain}/v1/billing/stripe-webhook`
- Events: `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`, `checkout.session.completed`, `charge.succeeded`
- All writes are idempotent; signature verification via `stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)`

### General
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` env vars enable billing features
- Storage limits: Free=1GB, Basic=10GB, Standard=25GB, Pro=50GB, Business=200GB, Enterprise=500GB
- Retention: Active = kept. Free/canceled = 60 days grace then delete media. Workflows never deleted.
- Cleanup cron: hourly (expire subs), daily 3AM UTC (R2 media cleanup)
- Cleanup cron startup is gated by `hasCredits()` in `server.ts`

### Stripe Testing with ngrok
- Stripe rejects `localhost` for live webhook delivery — use `stripe listen --forward-to=localhost:8000/v1/billing/stripe-webhook` for local testing, or ngrok for full external testing
- Frontend: `ngrok http 3000` — Vite proxy handles API calls seamlessly
- Webhook URL during ngrok testing: `https://<ngrok-url>/v1/billing/stripe-webhook`
- Add ngrok URL to Supabase Auth > Redirect URLs: `https://*.ngrok-free.app/**`

---

## Storage & Library

**Quota Enforcement:**
- DB-first: `storage_limit_bytes` in profiles takes precedence (admin override)
- Falls back to `TIER_STORAGE_LIMITS[tier]` from `ee/billing/stripe-config.ts`
- Self-hosted (`hasCredits() = false`): no enforcement
- Checked in `credit-guard.ts` + upload routes

**Admin Storage:** `PUT /v1/admin/users/:id/storage` -- progress bar + tier presets + custom GB

***REDACTED-OSS-SCRUB***

**Library:** `GET /v1/library` -- Storage summary, filter by type, cursor pagination, bulk delete.
Files: `backend/src/routes/library.ts`

---

## SSE Backend (`backend/src/lib/sse.ts`)

```typescript
import { createSSEStream } from "../lib/sse.js"

app.get("/v1/my-stream", async (req, reply) => {
  const sse = createSSEStream(req, reply)
  sse.sendEvent({ type: "progress", step: 1, total: 3, message: "Starting..." })
  sse.sendEvent({ type: "token", data: "Hello" })
  sse.sendEvent({ type: "done", data: { result: "ok" } })
  sse.close()
})
```

**Controller API:** `sendEvent(event)`, `sendComment(text?)`, `close()`, `isClosed`

**Event Protocol (`StreamEvent`):**

| Type | Fields | Purpose |
|------|--------|---------|
| `token` | `data: string` | Incremental text chunk |
| `metadata` | `data: Record<string, unknown>` | Model info, usage stats |
| `progress` | `step, total, message` | Step-based progress |
| `done` | `data: Record<string, unknown>` | Final result |
| `error` | `data: { code, message }` | Error with code |

**Behavior:** Sets `text/event-stream` headers + validates origin against allowlist (bypasses `@fastify/cors` but mirrors its config). Auto keepalive every 15s. All writes are no-ops after close.

### SSE Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/ai-writer/generate` | POST | Legacy sync (full JSON) |
| `/v1/ai-writer/generate-stream` | POST | SSE streaming (event stream) |

Both share same Zod schema, credit guard, and job lifecycle.

### Adding Streaming to a New Feature (Backend Steps)
Import `createSSEStream` from `../lib/sse.js`. Send `metadata` -> stream `token` events -> `done`/`error` + `close()`.

---

## AI Agent Node (formerly AI Writer)

Generates multiple image prompts from a single concept via Claude Sonnet (2 credits). Spawns individual Generate Image nodes on canvas.

### Workflow
1. Connect a **reference image** + optionally a **Face** node
2. Select template (Photo Shoot, Product Catalog, Storyboard, Custom)
3. Run -> generates N prompts separated by `===NEXT===`
4. "Create N Image Nodes" -> spawns Generate Image nodes in 2-column grid with edges
5. "Generate All N Images" -> runs all with concurrency limit of 3

### Architecture Notes
- Templates use `{outputCount}` placeholder replaced at runtime
- Predefined templates require connected reference image; Custom does not
- Created nodes tracked via `createdNodeIds` on AIWriterNodeData for cleanup on re-creation
- Prompt truncation: 1500 chars at node creation, 2000 chars after wrapper expansion
- Calls backend directly (not via proxy) to avoid 30s timeout
- Key file: `backend/src/routes/ai-writer.ts`

---

## Gallery & Private Mode

### Public Gallery
- `GET /v1/gallery` -- public, no auth. Params: `cursor`, `limit` (default 20, max 50), `type` (image/video/audio)
- Returns `{ data, nextCursor }` -- cursor-based pagination
- Download proxy: `GET /v1/download?url=...` streams R2 files with `Content-Disposition: attachment` (domain-locked to R2 bucket)

### Private Mode
- `GET /v1/user/settings?userId=` / `PATCH /v1/user/settings` -- tier + publicOutputs
- Only Standard/Pro/Business can set `publicOutputs = false` (Free/Basic always public)
- Worker sets `is_public` flag on jobs during processing based on user's `public_outputs` profile setting

### Key Files
- `backend/src/routes/gallery.ts` -- Gallery API with reference extraction
- `backend/src/routes/download.ts` -- Download proxy endpoint (R2 domain-locked)
- `backend/src/routes/user-settings.ts` -- User settings API route

---

## Workflow Execution Engine

Server-side workflow orchestration via BullMQ, enabling autonomous execution without a browser.

### Architecture
```
backend/src/services/workflow-engine/
  types.ts              — Shared types (NodeExecutionState, NodeOutput, WorkflowExecutionJob, etc.)
  execution-graph.ts    — Topological sort (Kahn's algorithm), skipped node propagation, media type sets
  input-resolver.ts     — Wire upstream outputs to downstream inputs (40+ node type routing rules)
  output-extractor.ts   — Extract output from completed jobs or source node data
  payload-builder.ts    — Build BullMQ job payloads per node type + credit model identifiers
  node-executor.ts      — Dispatch: worker-queued (BullMQ), sync HTTP (internal fetch), inline
  inline-executor.ts    — combine-text, split-text, composite (no external calls)
  sub-workflow-handler.ts — Recursive sub-workflow execution (depth limit 5, cycle detection)

backend/src/workers/orchestrator-worker.ts  — Main BullMQ worker (concurrency: 2)
backend/src/orchestrator.ts                 — Entry point (like worker.ts, render-worker.ts)
backend/src/lib/orchestration-queue.ts      — BullMQ queue "workflow-orchestration"
backend/src/lib/schedule-cron.ts            — Cron/interval scheduler (60s check interval)
```

### Execution Categories
| Category | Node Types | Mechanism |
|----------|-----------|-----------|
| Worker-queued | 40+ (generate-image, image-to-video, text-to-speech, FFmpeg nodes, etc.) | Create job → reserve credits → enqueue BullMQ → poll jobs table every 3s |
| Sync HTTP | ai-writer, video-composer, after-effects, lottie-overlay, 3d-title, motion-graphics, image-to-text | Internal `fetch("http://localhost:PORT/v1/...")` with service-role auth |
| Inline | combine-text, split-text, composite | Pure logic, no external calls |
| Source (no execution) | text-prompt, upload-*, webhook-trigger, schedule-trigger, list, loop, reference-audio | Output read from node data |

### API Routes

**Execution** (`routes/workflow-execution.ts`):
- `POST /v1/workflows/:id/run` — Create execution (manual trigger), enqueue orchestrator
- `GET /v1/workflow-executions/:id` — Execution status + node_states
- `POST /v1/workflow-executions/:id/cancel` — Cancel active execution
- `GET /v1/workflows/:id/executions` — List executions (paginated, cursor-based)

**Triggers** (`routes/webhook-triggers.ts`):
- `POST /v1/webhooks/:token` — **Public, no auth** (token IS auth). Rate limited 10/min per token
- `POST /v1/workflow-triggers` — Create trigger (webhook or schedule)
- `GET /v1/workflows/:id/triggers` — List triggers for workflow
- `PATCH /v1/workflow-triggers/:id` — Update trigger config/active state
- `DELETE /v1/workflow-triggers/:id` — Delete trigger

### Schedule Cron (`lib/schedule-cron.ts`)
- `setInterval` every 60 seconds (runs in server process via `startScheduleCron()`)
- Supports 5-field cron expressions AND simple interval strings ("5m", "1h", "1d")
- Respects `maxExecutions` limit, skips if workflow already has pending/running execution

### Timeouts
- Per-node: 30 minutes (`NODE_TIMEOUT_MS`)
- Per-workflow: 60 minutes (`WORKFLOW_TIMEOUT_MS`)
- Job polling interval: 3 seconds (`JOB_POLL_INTERVAL_MS`)

### Orchestrator Flow
1. Receive job → load workflow from DB → set status = 'running'
2. Inject trigger/source node data into nodeStates
3. Build execution levels (topological sort) → compute skipped nodes
4. For each level: resolve inputs → build payloads → execute nodes (parallel via `Promise.allSettled`)
5. Persist nodeStates after each level → check for cancellation between levels
6. On node failure: stop execution, mark failed
7. On completion: mark completed with total credits used

---

## Unified LLM Client (`lib/llm-client.ts`)

Unified interface for all LLM calls across 7 models and 3 tiers:

### Model Registry (`packages/shared/src/llm-models.ts`)
| Tier | Models | API Format |
|------|--------|------------|
| Economy | `gemini-3-flash`, `claude-haiku-4.5` | chat-completions, messages |
| Standard | `claude-sonnet-4.6`, `gpt-5.2` | messages, chat-completions |
| Premium | `gemini-3.1-pro`, `claude-opus-4.6`, `gpt-5.4` | chat-completions, messages, responses |

### API Formats
- **chat-completions** — Gemini, GPT-5.2 (`POST /api/v1/chat/completions`)
- **messages** — Claude models (`POST /claude/v1/messages` with `X-Api-Key` + `anthropic-version`)
- **responses** — GPT-5.4 (`POST /api/v1/responses` with `input` array + `developer` role)

### Functions
- `llmComplete(params)` — sync completion, returns `{ text, usage }`
- `llmStream(params)` — SSE streaming with `onToken` callback
- Both try KIE first, fallback to direct Anthropic SDK if `directFallbackModel` is set

### LLM Features & Credit Routing
- `LlmFeature` type covers 11 features: ai-writer, prompt-helper, scene-graph-ai, after-effects, motion-graphics, lottie-overlay, 3d-title, image-to-text, qa-check, generate-script, translate
- `buildLlmCreditIdentifier(feature, model)` → economy: `"feature:economy"`, standard: `"feature"`, premium: `"feature:premium"`
- `resolveLlmCreditId(feature, body)` — reads `llmModel` from raw request body before Zod strips it (for `creditGuard` preHandler)

---

## Admin Credit Audit

### Routes
- `POST /v1/admin/credit-audit/sync` — Dual mode: `"theoretical"` (KIE cost vs pricing table) or `"actual"` (actual charges vs KIE bills)
- `GET/PATCH/DELETE /v1/admin/credit-anomalies` — Track and resolve anomalous credit transactions
- `GET /v1/admin/kie-credits` — KIE account balance history (hourly snapshots)

### Audit Features
- `lookbackMinutes` parameter (max 43,200 = 30 days) for fine-grained time control
- Per-cost-level variable pricing validation with `tierBreakdown` array
- `T2V_CREDIT_OVERRIDES` prevents cross-billing between T2V and I2V prices
- `fetchAllKieLogs()` — parallel fetches across all KIE endpoints, deduplicates by `taskId`
- Extended `buildModelMap()` covering 16 model categories with aliases (Suno chirp codenames, Flux Kontext variants, VEO record endpoint names)

---

## VEO 3/3.1 Configuration

| Feature | VEO 3 (`veo3`) | VEO 3.1 (`veo3.1`) |
|---------|----------------|---------------------|
| KIE model | `veo3` | `veo3_fast` |
| Duration | 8s fixed | 8s fixed |
| Aspect ratio | Auto / 16:9 / 9:16 | Auto / 16:9 / 9:16 |
| Seed | 10000-99999 | 10000-99999 |
| Generate audio | N/A | Checkbox (default on) |
| I2V support | `imageUrls: [start, end?]` | `imageUrls: [start, end?]` |
| T2V support | Yes | Yes (added via VEO 3.1 Fast) |

### Sora Watermark Removal
- `sora-watermark-remove` in `KIE_SPECIAL_MODELS` (model: `sora-2-watermark-remove`, 10 KIE credits)
- Uses separate post-processing endpoint (NOT `remove_watermark` param which causes KIE 500 errors)
- Requires `kieTaskId` from prior Sora generation as input

---

*Last updated: 2026-03-17*

---

## Architecture Rules (non-obvious) — migrated from root CLAUDE.md

| Area | Rule |
|------|------|
| `packages/shared/` | Pure logic shared between frontend + backend. Frontend imports the workspace package by name (`@nodaro/shared`, resolves to `packages/shared/dist/`). Backend uses RELATIVE imports — `tsc` doesn't rewrite path aliases. Backend `rootDir: ".."` so dist output is `dist/backend/src/`. Dockerfile must copy `packages/shared/dist/` into every build stage. **i18n sidecar exception:** `frontend/src/lib/i18n-bootstrap.ts` does `import.meta.glob("../../../packages/shared/src/i18n/*.*.ts")` so Vite can code-split each locale chunk. tsup bundles everything into one `dist/index.js`, so the per-file split is lost there — the Dockerfile's `frontend-build` stage must ALSO copy `packages/shared/src/i18n/` (not just dist) or the glob returns empty and every picker silently falls back to English. |
| Credit pricing | 1 credit = $0.02. Composite identifiers for variable pricing (`"gpt-image:high"`, `"flux:2K"`) — `VARIABLE_PRICING_MODELS` in `model-options.ts`, `buildCreditModelIdentifier()` in `helpers.ts` + route handlers. `STATIC_CREDIT_COSTS` is a runtime fallback only — admin UI reads from the `model_pricing` DB table. **Hard-fail policy (2026-05):** if neither `model_pricing` nor `STATIC_CREDIT_COSTS` has the identifier, `getModelCreditBaseCost` throws `PriceNotConfiguredError` and the route returns HTTP 503 `price_not_configured` (no silent fallback to 1 credit). Regression net: `backend/src/ee/billing/__tests__/hard-fail-coverage.test.ts`. |
| LLM routing | All LLM calls go through `backend/src/lib/llm-client.ts` (`llmComplete()` / `llmStream()`). Model registry: `packages/shared/src/llm-models.ts`. Tiered pricing via `buildLlmCreditIdentifier()`. `resolveLlmCreditId()` reads `llmModel` from RAW body before Zod strips it. |
| Workflow orchestrator | BullMQ `"workflow-orchestration"` queue. Topological sort → level-by-level parallel execution. 3 execution categories: worker-queued (existing BullMQ queues), sync HTTP (internal fetch with service-role auth), inline (combine-text, split-text, composite). Per-node timeout 30min, per-workflow 60min. Stop modes: `"cancelled"` (immediate) vs `"stopping"` (finish current level). |
| Sub-workflow hierarchy | `parent_workflow_id` (migration 116) marks workflows that were auto-created from inside another. List endpoints (`GET /v1/projects/:id/workflows`, MCP `list_workflows`, `/v1/workflows/callable`) hide rows with `parent_workflow_id IS NOT NULL` so child workflows don't pollute project lists. Standalone workflows referenced by sub-workflow nodes (existing flow) keep `parent_workflow_id = NULL` and remain visible. Editable fullscreen sub-canvas via route-based navigation + breadcrumb (`useSubWorkflowStack`, `SubWorkflowBreadcrumb`, `useNavigateWithGuard` so dirty-state prompt fires). View modes via client-side registry at `frontend/src/components/nodes/sub-workflow-views/view-mode-registry.ts` (ships with default Ports view; storyboard/video/script land with the Story-to-Video Shot container in v2). Validation: every `sub-workflow-input` must pair with a `sub-workflow-output` sharing `routeId` and have ≥1 outputPort — enforced at workflow POST + PATCH via `validateSubWorkflowRoutes` in `@nodaro/shared`. New endpoint: `POST /v1/workflows/:parentId/sub-workflows` seeds a child with one input + one output node. |
| Tier parallelism | `TIER_PARALLELISM` in `stripe-config.ts` + `pricing-data.ts`: free=2, basic=4, standard=6, pro=10, business=12. Self-hosted editions read `MAX_CONCURRENT_NODES_PER_EXECUTION` env (default 12) as hard ceiling. |
| Single-node execution history | Frontend `setCurrentWorkflowId()` + `withWorkflowId()` inject workflowId into all job-creating API calls. Backend `extractWorkflowId(req.body)` reads it BEFORE Zod strips it. Standalone jobs (no `workflow_execution_id`) merged into execution lists as `triggerType: "single-node"`. |
| Watermark | Decision stored on `jobs.should_watermark` at credit reservation (NOT read from `profiles.tier` at processing time — prevents tier-upgrade bypass). |
| Webhook triggers | Public route `POST /v1/webhooks/:token` — 32-byte hex token IS auth. Rate-limited 10/min per token. |
| TTS v3 vs v2 | ElevenLabs v3 supports `[audio tags]` and routes through direct ElevenLabs API (never KIE). v2 models go via KIE; worker `stripAudioTags()` removes `[…]` before sending. |
| Auth + OAuth | 4 auth modes in `middleware/auth.ts`: Supabase JWT (`eyJ...`), OAuth dev-app token (`ndr_app_<64hex>`, 90-day TTL — sets `req.appAuthorization{appId, scopes}`), API token (`ndr_<64hex>`, legacy), internal RPC (`X-Internal-Orchestrator-Secret`). Resolution order: public route → internal-secret → `ndr_app_` → JWT → 401. Scope enforcement via `requireScope(req.appAuthorization?.scopes ?? [], scope)` — Supabase JWT path is no-op (user owns resources). 8 scopes in `lib/scopes.ts`. |
| Dynamic CORS | `lib/dynamic-origins.ts` — async DB-backed allowlist (60s cache, stampede-safe). Combines `getStaticAllowedOrigins()` (PUBLIC_URL + CORS_ORIGIN env) with `developer_apps.allowed_origins`. Cache invalidated on dev-app create/update/delete. Both `app.ts` CORS (async-promise form — NOT callback-form, double-fires) and `sse.ts createSSEStream` (now async) consume `isOriginAllowedDynamic()`. |
| Developer apps | `developer_apps` + `developer_app_authorizations` + `developer_app_tokens` tables. `POST /v1/developer-apps` (JWT) returns plaintext `clientSecret` ONCE. `POST /v1/oauth/authorize` (JWT) → one-shot code (10-min TTL) → `POST /v1/oauth/token` (client credentials) → `access_token`. RFC 7009 `revoke`. Public `GET /v1/oauth/app-info?client_id=` for consent screens. Service-role supabase imports allow-listed in `scripts/check-admin-client-import.mjs` (every query scoped by `owner_user_id` in-handler). |
| MCP server | Per-request `McpServer` at `POST/GET /mcp` (`backend/src/lib/mcp/`). 4 tool families (verbs/jobs/workflows/components/apps/models/gallery) gated by scope; widgets returned alongside text from generation tools. **Workflow tools (`tools/workflows.ts`):** 9 tools — `list_workflows`/`get_workflow`/`get_workflow_json`/`export_workflow` (`workflows:read`), `create_workflow`/`delete_workflow`/`update_workflow_json`/`import_workflow` (`workflows:write`), `run_workflow` (`workflows:execute`). All except `export_workflow` are scoped to the user's auto-created "mcp" project via `ensureMcpProject(session)` (`tools/_mcp-project.ts`, caches `session.mcpProjectId`) — they validate `project_id` matches before any read/write/run. `export_workflow` can export ANY of the caller's workflows (template mode strips generated fields via `stripExportContent`; `with_assets=true` bundles characters/objects/locations — logic mirrors `routes/workflows.ts` since MCP has no user JWT). `import_workflow` parses + Zod-validates the bundle, re-creates bundled assets under the caller, remaps `*DbId` node fields, and always lands the workflow in the mcp project. `update_workflow_json` supports optimistic concurrency via `expected_updated_at`. **`buildMcpServer` is async** — `await registerDynamicTools()` inside. v2.0: per-user dynamic factory (`tools/dynamic.ts`) registers `app_<slug>` / `component_<slug>` MCP tools (cap 15+15=30) sorted by `coalesce(last_run_at, created_at) desc`. **Schema:** `published_apps` uses `creator_id` (NOT `owner_user_id`) and `is_active` (NOT `deleted_at`); migration 096 adds `last_run_at` + per-user recency index. Workflow widget (`widgets/workflow.ts`) is a vertical pill list with live `node:<id>:<status>` updates bridged from `executionEvents` → MCP `ui/message` via `progress-emitter.ts`. Widget runtime JS is `createElement`+`textContent` only — no raw HTML assignment; snapshot tests guard. v3.0: `/v1/oauth/app-info` returns `kind` (from migration 094); consent UI renders `<McpConsentNotice>` orange warning when `kind=dynamic_mcp` (self-claimed name via RFC 7591 DCR). Public docs at `docs/mcp/`; marketing landing at `/mcp`. |
| Image-to-video Loop Trim | `loopTrim?: { enabled, framesToTest, quality }` on `ImageToVideoData` runs a generic PSNR-based smart-loop-cut post-process after any i2v generation. Replaces the VEO-only `autoLoopTrim` (auto-migrated on workflow load via `use-workflow-store.ts:loadWorkflow`). Two quality modes: lossless (keyframe stream-copy, byte-perfect) / precise (libx264 re-encode, frame-precise). Pricing add-on: `ceil(duration/5) + ceil(framesToTest/24)` on top of the i2v base, wired via `computeCredits` hook on `creditGuard` (uses `getModelCreditBaseCost` to avoid double-markup). Failure mode: smart-loop-cut errors don't fail the whole job — the un-trimmed clip is kept and only the addon is refunded via `refundLoopTrimAddon` in `workers/shared.ts`. |
| Combine-videos resolution | `combineVideos` (`backend/src/providers/video/combine-videos.ts`) probes every downloaded clip up front via `pickTargetResolution` (most common (W,H), ties → largest area) and passes that target into `normalizeVideoForCombine`, which applies `scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1` to letterbox every clip to exactly the target. Without this, `xfade`/`acrossfade`/`concat` filters reject mismatched dimensions (`First input link main parameters (size A) do not match the corresponding second input link xfade parameters (size B)`). Even-rounding for yuv420p lives in `normalizeVideoForCombine` only. The dip-to-black/white path reuses the same target for its color clips. |
| Default project per user | Migration 116 adds `projects.is_default BOOLEAN` + partial unique index `(user_id) WHERE is_default = TRUE` (one default per user). `ensure_default_project()` SECURITY DEFINER RPC returns the caller's default project, lazy-creating "My Recent Flows" on first need — frontend uses `supabase.rpc()` directly; backend helper `lib/default-project.ts::ensureDefaultProject(userId)` reproduces the lookup-or-insert in-handler (the RPC depends on `auth.uid()` which is null under the service-role client). `prevent_default_project_delete()` BEFORE DELETE trigger blocks DELETE on default rows for both Supabase JS and Fastify paths; `DELETE /v1/projects/:id` returns a friendly 409 `default_project` before the trigger fires. New `POST /v1/workflows` (no `:projectId` in path) accepts optional `projectId` — when omitted, lands in the caller's default project; powers the dashboard split button's "+ New Workflow" quick-create. New `GET /v1/workflows` returns the caller's flat workflow list (used by the SDK/CLI/MCP; the frontend hits Supabase JS directly via `useMyWorkflows`). `PATCH /v1/workflows/:id` now accepts `projectId` for cross-project move — ownership-checked, auto-clears `folder_id` (folders are project-scoped). Dashboard `/projects` adds a workspace tab strip (`My Workflows` default | `My Projects`) persisted to `localStorage.nodaro-dashboard-workspace-tab` + URL `?tab=`. Default projects render with a ⭐ icon + `title=Auto-created — your default workspace` tooltip and hide the Delete menu item; the store's `deleteProject` guards client-side too. |
| Internal-only models | Synthetic provider/model ids set by the orchestrator (never user-submitted) bypass the user-facing UI half of the Provider Enum Sync (steps 1, 2, 2b, 8, 8b, 11, 12, 12b). They MUST be in `STATIC_CREDIT_COSTS` + `model_pricing` seed + provider `supportedModels`. Workflow-run swap lives in `payload-builder.ts` (case `generate-image`); single-node Run uses a pre-Zod swap in `routes/generate-image.ts` via the `_internalLora` body hint AND a matching short-circuit in the inline `creditGuard` preHandler resolver (otherwise credits reserve as the default provider, 1cr silent under-bill). Reference: `flux-lora-character` (3cr/image) — selected when a single trained `@character` mention is detected. Companion training id `character-lora-training` (150cr/training, Cloud only). |
| Suno Voice Persona | Setup-time node — does NOT execute at workflow runtime. 3-step modal flow: ① POST `/v1/suno/voice/validate` + poll GET `/v1/suno/voice/validate-info` → returns `validateInfo` phrase; ② user records phrase + uploads via `uploadAudio`; ③ POST `/v1/suno/voice/generate` (creditGuard `"suno-voice-create"`, 20cr reserved on a `jobs` row) + poll GET `/v1/suno/voice/record-info` → returns `voiceId`. **IDOR scoping (audit fix):** every voice route that takes a `taskId` verifies ownership via `userOwnsVoiceTask(taskId, userId, tag)`. Ownership rows are `jobs` tagged `model_identifier="suno-voice-validate"` (validate/regenerate, free) or `"suno-voice-create"` (generate, 20cr). Polls return 404 when not owned; generate refuses to charge if the input validate `taskId` isn't owned. GET `/voice/record-info` doubles as commit/refund site: on `status="success"` marks job completed + commits credits, on `status="fail"` marks failed + refunds. Both via `commitReservedCreditsForJob` / `refundReservedCreditsForJob` (CAS on `status='reserved'`, idempotent). Rate-limit 5/min/token on `/voice/generate`. **Stale-job sweep (audit fix):** `sweepStaleVoiceJobs` in `ee/billing/cleanup-service.ts` (cron `45 * * * *`) refunds `suno-voice-create` jobs stuck >2h in `pending/processing` (closing the abandoned-modal credit-leak hole — there's no KIE webhook fallback like character-lora), and GC's validate rows >24h. Suno music nodes (`suno-generate` / `suno-cover` / `suno-extend`) gained `personaId` + `personaModel` body fields → wired through worker → KIE API. The `suno-voice` node is registered in `SOURCE_NODE_TYPES` (`execution-graph.ts`) so the orchestrator skips execution at runtime; `output-extractor.ts` emits `{ voiceId, personaId, personaModel: "voice_persona", voiceName, style }` from `data.voiceId` AND `getPrimaryOutput` has a `case "suno-voice"` returning `output.voiceId` (without this case the orchestrator's `if (!output) continue` skipped the entire suno-voice → personaId routing block — only single-node Run worked). Frontend resolver `node-input-resolver.ts` + backend resolver `input-resolver.ts` both route `voiceId` → `personaId` when downstream is one of the 3 music nodes (no-op otherwise so the edge stays valid). Pricing seeded in migration 130 + `STATIC_CREDIT_COSTS["suno-voice-create"] = 20`. KIE does not publish pricing — value is a conservative one-time default, tune via `audit-credits` after usage data. |
| Character LoRA training | Migration 126 adds 7 `lora_*` columns to `characters` + a partial index on in-flight statuses. Cloud-only routes `/v1/characters/:id/{train,training,lora}` + public webhook `/v1/webhooks/replicate-training` (auth.ts allow-list covers `/v1/webhooks` prefix). Training: Replicate `ostris/flux-dev-lora-trainer` (1000 steps), pinned version; webhook delivers ONE `completed` event (`webhook_events_filter`) ~15min later. Signature verification via SDK `validateWebhook` top-level export (second overload with explicit `{id,timestamp,signature,body,secret}` — Fastify `req.raw` is `IncomingMessage`, NOT a Fetch `Request`). RawBody captured via in-plugin `addContentTypeParser` mirroring `stripe-webhook.ts:42-53` (this repo has NO `fastify-raw-body` plugin). Atomic CAS slot claim in the train route uses Supabase JS `.or("lora_training_status.is.null,lora_training_status.in.(succeeded,failed,cancelled)")` — `.in()` does NOT match NULL. All webhook UPDATEs include `.not("lora_training_status","in","(succeeded,cancelled)")` for monotonic state. Try/catch covers steps 1–6 + checks `reply.sent` after `reserveCreditsForJob` so a 503 from creditGuard still triggers CAS rollback + zip cleanup. R2 zip cleanup via `s3.send(new DeleteObjectCommand(...))` on dispatch failure (cleanup-cron does NOT cover `character-training/` prefix). Replicate SDK has NO `models.delete` method — `deleteCharacterLora(modelDestination)` uses raw `DELETE /v1/models/{owner}/{name}` REST with `Authorization: Bearer ${REPLICATE_API_TOKEN}`, 404 swallowed for idempotency. Soft-delete handler in `routes/characters.ts` cancels in-flight training, refunds reserved credits, deletes the Replicate model BEFORE flipping `deleted_at`. Polling-primary live updates: modal calls `GET /training` every 8s while in-flight; Realtime is optional follow-up (would require new migration to publish `characters` on `supabase_realtime`). 4-edge propagation: `ConnectedReference` + `CharacterNodeData` + backend `expandWiredCharacterRefs` + frontend `expandCharacterNodeIntoRefs` all carry `loraReplicateVersion`/`loraTriggerWord`/`loraTrainingStatus` for the routing decision. `selectLoraRoutingForMentions` requires EXACTLY ONE distinct trained character; 2+ → fall back to ref injection (multi-LoRA = Phase 2). Required env: `REPLICATE_WEBHOOK_SECRET` (strict envSchema, default `""` → 503 `webhook_not_configured`); `PUBLIC_URL` must be non-empty (else 503 `public_url_not_configured`). Route rate-limited 3/min/token. |

---

## App Run Archive (soft-delete) — migrated from root CLAUDE.md

`app_runs.deleted_at` makes `DELETE /v1/app/:slug/runs/:runId` a soft-delete. The run is hidden from the default list and recoverable from `/archived-runs` in the UI. API / SDK (`client.apps.deleteRun()`) / MCP (`delete_app_run` tool) all soft-delete by design — they cannot destroy data.

UI-only routes (deliberately not surfaced in SDK/MCP):
- `GET  /v1/me/archived-runs` — global archive list across all apps
- `POST /v1/app/:slug/runs/:runId/restore` — un-archive
- `DELETE /v1/app/:slug/runs/:runId/permanent` — real destroy (row + workflow_executions row; R2 reaped by cleanup-cron)

Permanent delete requires the run to be archived first (returns 400 `not_archived` otherwise).
