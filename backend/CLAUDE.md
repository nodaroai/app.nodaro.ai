# Backend — Claude Code Reference

## ESM Imports — Use Explicit `.js` Extensions (CRITICAL)

Every relative import in `backend/src/` MUST end in `.js`, even when importing a `.ts` file:

```typescript
// ✅ Correct
import { foo } from "./bar.js"
import { baz } from "../lib/baz.js"
export { Thing } from "./types.js"

// ❌ Wrong — crashes production
import { foo } from "./bar"
import { baz } from "../lib/baz"
```

**Why it matters:** the backend ships compiled JS (`tsc -p tsconfig.build.json` → `dist/`) and runs via `node dist/server.js`. Node ESM (`"type": "module"` in `backend/package.json`) requires explicit `.js` extensions on relative imports and throws `ERR_MODULE_NOT_FOUND` on extensionless paths, crashing the entire process at startup.

**Why CI does not catch it on its own:** `tsconfig.json` uses `"moduleResolution": "bundler"`, which tells tsc to pass extensionless imports through verbatim (it assumes a bundler will resolve them later — but there is no bundler in this pipeline). Vitest uses its own tolerant resolver against the `.ts` source, so unit tests never see the broken compiled JS. The dedicated `backend-boot-smoke` job in `.github/workflows/ci.yml` does catch it by actually starting `node dist/server.js` against stub env vars and probing `/health`.

***REDACTED-OSS-SCRUB***

---

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
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***

### Model Identifiers (Case-Sensitive)
All use **lowercase with hyphens** except VEO which uses **dot notation**: `veo3`, `veo3.1` (NOT `veo-3` or `veo_3.1`)

### Duration Validation
- VEO 3.1 (veo3 Quality, veo3.1 Fast, veo3_lite): 4 / 6 / 8 seconds (flat per-generation pricing)
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
- Free tier: **150** credits, 50/day cap, veo3/sora2-pro blocked, outputs watermarked

### Pricing
***REDACTED-OSS-SCRUB***
- Tiers: Free ($0/150cr), Basic ($12mo/$10yr/250cr), Standard ($29mo/$24yr/850cr), Pro ($59mo/$49yr/2000cr), Business ($129mo/$109yr/4800cr)
- Top-ups: $10/150cr, $25/450cr, $50/1000cr, $100/2200cr (never expire)

### Variable Credit Pricing (Composite Model Identifiers)
Some models cost different credits based on quality/resolution settings.
Composite identifiers use `:` separator: `{provider}:{setting_value}`.

| Model | Default | Higher Setting | Credits (default → higher) |
|-------|---------|----------------|----------------------------|
| gpt-image | medium | high | 4 → 6 |
| nano-banana-pro | 1K/2K | 4K | 5 → 6 |
| flux | 1K | 2K | 2 → 2 (2K no longer surcharges) |
| flux-flex | 1K | 2K | 4 → 6 |
| ideogram-v3 | BALANCED | TURBO/QUALITY | 2 → 1/3 |

**Implementation:**
- Backend: `buildCreditModelIdentifier()` in `generate-image.ts` / `image-to-image.ts` builds composite ID from request body
- Frontend: `buildCreditModelIdentifier()` in `config-panels/helpers.ts` builds composite ID from node data
- `VARIABLE_PRICING_MODELS` in `model-options.ts` maps provider → which setting affects cost
- `STATIC_CREDIT_COSTS` in `credits.ts` has both base and composite entries

### Credit Cost Per Node

***REDACTED-OSS-SCRUB***

| Node Type | Credits | Notes |
|-----------|---------|-------|
| generate-script | 2 | Gemini Flash (economy 1 / standard 2 / premium 3) |
| generate-image | 1-6 | z-image=1, nano-banana=1, flux=2, grok=1, gpt-image=4 (medium) / 6 (high), nano-banana-pro=5/6, ideogram-v3=1-3 |
| image-to-image | 1-6 | flux-pro-i2i=2/2, gpt-image-i2i=4/6, flux-i2i=4/6, ideogram variants=1-6 |
| edit-image | 1-3 | recraft-remove-bg=1, recraft-upscale=1, nano-banana-edit=2, topaz=3 |
| image-to-video | 5-63 | kling-turbo=11, minimax=15, kling=28, grok-i2v=5, veo3.1=15, veo3=63 — most are duration/resolution-tiered composites |
| text-to-video | 5-63 | Same as image-to-video |
| text-to-speech | 3 | ElevenLabs v3 (default, direct API), Turbo v2.5 / Multilingual v2 (via KIE.ai); `stripAudioTags()` removes `[...]` for v2 |
| voice-clone | 5 | ElevenLabs instant voice clone (direct API) |
| generate-music | 18 | node-type id reserves 18, metered down to the provider actual at commit (Suno v4/v5 = 3) |
| text-to-audio | 3 | ElevenLabs SFX |
| ai-writer | 3 | Claude Sonnet (standard LLM tier); varies by tier via `ai-writer:economy` / `ai-writer:premium` |
| lottie-overlay | 2 | Claude Sonnet → Lottie overlay plan |
| 3d-title | 2 | Claude Sonnet → 3D title plan (camera, lighting, text, particles) |
| voice-design | 5 | ElevenLabs `/v1/text-to-voice/design` (direct API), full controls: model, loudness, guidance, seed, quality, enhance |
| qa-check | 1 | Gemini Flash |
| render-video | 5 | Remotion cloud render |
| FFmpeg nodes | dynamic (duration-based) | combine-videos/merge-video-audio/add-captions/resize/trim/extract-audio/mix-audio/adjust-volume — computed at runtime; static fallbacks 1-3 |

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

Generates multiple image prompts from a single concept via Claude Sonnet (3 credits). Spawns individual Generate Image nodes on canvas.

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
| Source (no execution) | text-prompt, upload-*, webhook-trigger, schedule-trigger, list, reference-audio | Output read from node data |

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
| Premium | `gemini-3.1-pro`, `claude-opus-4.7`, `gpt-5.4` | chat-completions, messages, responses |

### API Formats
- **chat-completions** — Gemini, GPT-5.2 (`POST /api/v1/chat/completions`)
- **messages** — Claude models (`POST /claude/v1/messages` with `X-Api-Key` + `anthropic-version`)
- **responses** — GPT-5.4 (`POST /api/v1/responses` with `input` array + `developer` role)

### Functions
- `llmComplete(params)` — sync completion, returns `{ text, usage }`
- `llmStream(params)` — SSE streaming with `onToken` callback
- Both try KIE first, fallback to direct Anthropic SDK if `directFallbackModel` is set

### LLM Features & Credit Routing
- `LlmFeature` type covers 13 features: ai-writer, llm-chat, prompt-helper, scene-graph-ai, after-effects, motion-graphics, lottie-overlay, 3d-title, image-to-text, qa-check, generate-script, translate, image-critic
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

## VEO 3.1 Configuration

All three tiers are VEO 3.1 per [docs.kie.ai/veo3-api/generate-veo-3-video](https://docs.kie.ai/veo3-api/generate-veo-3-video). The bare `veo3` model id is legacy naming — it maps to VEO 3.1 Quality on KIE's endpoint. Existing workflows keep working; only the user-facing labels say "VEO 3.1".

| Feature | Quality (`veo3` → `veo3`) | Fast (`veo3.1` → `veo3_fast`) | Lite (`veo3_lite` → `veo3_lite`) |
|---------|----------------------------|--------------------------------|-----------------------------------|
| Duration | 4 / 6 / 8s | 4 / 6 / 8s | 4 / 6 / 8s |
| Pricing | Flat per generation (250 KIE cr) | Flat per generation (60 cr @ 720p, 65 @ 1080p) | Flat per generation (30 cr @ 720p, 35 @ 1080p) |
| Resolution | 720p / 1080p (4K via upgrade node) | 720p / 1080p | 720p / 1080p |
| Aspect ratio | Auto / 16:9 / 9:16 | Auto / 16:9 / 9:16 | Auto / 16:9 / 9:16 |
| Seed | 10000-99999 | 10000-99999 | 10000-99999 |
| Generate audio | Checkbox (default on) | Checkbox (default on) | Checkbox (default on) |
| Start + end frame | `imageUrls: [start, end?]` | `imageUrls: [start, end?]` | `imageUrls: [start, end?]` |
| T2V | Yes | Yes | Yes |

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
| Sub-workflow hierarchy | `parent_workflow_id` (migration 116) marks workflows that were auto-created from inside another. List endpoints (`GET /v1/projects/:id/workflows`, MCP `list_workflows`, `/v1/workflows/callable`) hide rows with `parent_workflow_id IS NOT NULL` so child workflows don't pollute project lists. Standalone workflows referenced by sub-workflow nodes (existing flow) keep `parent_workflow_id = NULL` and remain visible. Editable fullscreen sub-canvas via route-based navigation + breadcrumb (`useSubWorkflowStack`, `SubWorkflowBreadcrumb`, `useNavigateWithGuard` so dirty-state prompt fires). View modes via client-side registry at `frontend/src/components/nodes/sub-workflow-views/view-mode-registry.ts` (ships with default Ports view; storyboard/video/script land with the Story-to-Video Shot container in v2). Validation: every `sub-workflow-input` must pair with a `sub-workflow-output` sharing `routeId` and have ≥1 outputPort — enforced at workflow POST + PATCH via `validateSubWorkflowRoutes` in `@nodaro/shared`. New endpoint: `POST /v1/workflows/:parentId/sub-workflows` seeds a child with one input + one output node. |
| Tier parallelism | `TIER_PARALLELISM` in `stripe-config.ts` + `pricing-data.ts`: free=2, basic=4, standard=6, pro=10, business=12. Self-hosted editions read `MAX_CONCURRENT_NODES_PER_EXECUTION` env (default 12) as hard ceiling. |
| Single-node execution history | Frontend `setCurrentWorkflowId()` + `withWorkflowId()` inject workflowId into all job-creating API calls. Backend `extractWorkflowId(req.body)` reads it BEFORE Zod strips it. Standalone jobs (no `workflow_execution_id`) merged into execution lists as `triggerType: "single-node"`. |
| Webhook triggers | Public route `POST /v1/webhooks/:token` — 32-byte hex token IS auth. Rate-limited 10/min per token. |
| TTS v3 vs v2 | ElevenLabs v3 supports `[audio tags]` and routes through direct ElevenLabs API (never KIE). v2 models go via KIE; worker `stripAudioTags()` removes `[…]` before sending. |
| MCP server | Per-request `McpServer` at `POST/GET /mcp` (`backend/src/lib/mcp/`). 4 tool families (verbs/jobs/workflows/components/apps/models/gallery) gated by scope; widgets returned alongside text from generation tools. **Workflow tools (`tools/workflows.ts`):** 9 tools — `list_workflows`/`get_workflow`/`get_workflow_json`/`export_workflow` (`workflows:read`), `create_workflow`/`delete_workflow`/`update_workflow_json`/`import_workflow` (`workflows:write`), `run_workflow` (`workflows:execute`). All except `export_workflow` are scoped to the user's auto-created "mcp" project via `ensureMcpProject(session)` (`tools/_mcp-project.ts`, caches `session.mcpProjectId`) — they validate `project_id` matches before any read/write/run. `export_workflow` can export ANY of the caller's workflows (template mode strips generated fields via `stripExportContent`; `with_assets=true` bundles characters/objects/locations — logic mirrors `routes/workflows.ts` since MCP has no user JWT). `import_workflow` parses + Zod-validates the bundle, re-creates bundled assets under the caller, remaps `*DbId` node fields, and always lands the workflow in the mcp project. `update_workflow_json` supports optimistic concurrency via `expected_updated_at`. **`buildMcpServer` is async** (`Promise<McpServer>`). **v3.0: per-user dynamic `app_<slug>` / `component_<slug>` MCP tools were dropped** (`tools/dynamic.ts` removed — they didn't scale and competed with the verb tools). Apps and saved components are now reached via static discovery tools: `list_apps` / `get_app_inputs` / `run_app` (`tools/apps.ts`) and `list_components` / `get_component_inputs` / `run_component` (`tools/components.ts`). The `published_apps.last_run_at` recency index (migration 096) still powers default ordering in `list_apps`. **Schema:** `published_apps` uses `creator_id` (NOT `owner_user_id`) and `is_active` (NOT `deleted_at`); migration 096 adds `last_run_at` + per-user recency index. Workflow widget (`widgets/workflow.ts`) is a vertical pill list with live `node:<id>:<status>` updates bridged from `executionEvents` → MCP `ui/message` via `progress-emitter.ts`. Widget runtime JS is `createElement`+`textContent` only — no raw HTML assignment; snapshot tests guard. v3.0: `/v1/oauth/app-info` returns `kind` (from migration 094); consent UI renders `<McpConsentNotice>` orange warning when `kind=dynamic_mcp` (self-claimed name via RFC 7591 DCR). Public docs at `docs/mcp/`; marketing landing at `/mcp`. |
| Image-to-video Loop Trim | `loopTrim?: { enabled, framesToTest, quality }` on `ImageToVideoData` runs a generic PSNR-based smart-loop-cut post-process after any i2v generation. Replaces the VEO-only `autoLoopTrim` (auto-migrated on workflow load via `use-workflow-store.ts:loadWorkflow`). Two quality modes: lossless (keyframe stream-copy, byte-perfect) / precise (libx264 re-encode, frame-precise). Pricing add-on: `ceil(duration/5) + ceil(framesToTest/24)` on top of the i2v base, wired via `computeCredits` hook on `creditGuard` (uses `getModelCreditBaseCost` to avoid double-markup). Failure mode: smart-loop-cut errors don't fail the whole job — the un-trimmed clip is kept and only the addon is refunded via `refundLoopTrimAddon` in `workers/shared.ts`. |
| Combine-videos resolution | `combineVideos` (`backend/src/providers/video/combine-videos.ts`) probes every downloaded clip up front via `pickTargetResolution` (most common (W,H), ties → largest area) and passes that target into `normalizeVideoForCombine`, which applies `scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1` to letterbox every clip to exactly the target. Without this, `xfade`/`acrossfade`/`concat` filters reject mismatched dimensions (`First input link main parameters (size A) do not match the corresponding second input link xfade parameters (size B)`). Even-rounding for yuv420p lives in `normalizeVideoForCombine` only. The dip-to-black/white path reuses the same target for its color clips. |
| Default project per user | Migration 116 adds `projects.is_default BOOLEAN` + partial unique index `(user_id) WHERE is_default = TRUE` (one default per user). `ensure_default_project()` SECURITY DEFINER RPC returns the caller's default project, lazy-creating "My Recent Flows" on first need — frontend uses `supabase.rpc()` directly; backend helper `lib/default-project.ts::ensureDefaultProject(userId)` reproduces the lookup-or-insert in-handler (the RPC depends on `auth.uid()` which is null under the service-role client). `prevent_default_project_delete()` BEFORE DELETE trigger blocks DELETE on default rows for both Supabase JS and Fastify paths; `DELETE /v1/projects/:id` returns a friendly 409 `default_project` before the trigger fires. New `POST /v1/workflows` (no `:projectId` in path) accepts optional `projectId` — when omitted, lands in the caller's default project; powers the dashboard split button's "+ New Workflow" quick-create. New `GET /v1/workflows` returns the caller's flat workflow list (used by the SDK/CLI/MCP; the frontend hits Supabase JS directly via `useMyWorkflows`). `PATCH /v1/workflows/:id` now accepts `projectId` for cross-project move — ownership-checked, auto-clears `folder_id` (folders are project-scoped). Dashboard `/projects` adds a workspace tab strip (`My Workflows` default | `My Projects`) persisted to `localStorage.nodaro-dashboard-workspace-tab` + URL `?tab=`. Default projects render with a ⭐ icon + `title=Auto-created — your default workspace` tooltip and hide the Delete menu item; the store's `deleteProject` guards client-side too. |
| Internal-only models | Synthetic provider/model ids set by the orchestrator (never user-submitted) bypass the user-facing UI half of the Provider Enum Sync (steps 1, 2, 2b, 8, 8b, 11, 12, 12b). They MUST be in `STATIC_CREDIT_COSTS` + `model_pricing` seed + provider `supportedModels`. Workflow-run swap lives in `payload-builder.ts` (case `generate-image`); single-node Run uses a pre-Zod swap in `routes/generate-image.ts` via the `_internalLora` body hint AND a matching short-circuit in the inline `creditGuard` preHandler resolver (otherwise credits reserve as the default provider, 1cr silent under-bill). Reference: `flux-lora-character` (2cr/image) — selected when a single trained `@character` mention is detected. Companion training id `character-lora-training` (150cr/training, Cloud only). |
| Suno Voice Persona | Setup-time node — does NOT execute at workflow runtime. 3-step modal flow: ① POST `/v1/suno/voice/validate` + poll GET `/v1/suno/voice/validate-info` → returns `validateInfo` phrase; ② user records phrase + uploads via `uploadAudio`; ③ POST `/v1/suno/voice/generate` (creditGuard `"suno-voice-create"`, 20cr reserved on a `jobs` row) + poll GET `/v1/suno/voice/record-info` → returns `voiceId`. **IDOR scoping (audit fix):** every voice route that takes a `taskId` verifies ownership via `userOwnsVoiceTask(taskId, userId, tag)`. Ownership rows are `jobs` tagged `model_identifier="suno-voice-validate"` (validate/regenerate, free) or `"suno-voice-create"` (generate, 20cr). Polls return 404 when not owned; generate refuses to charge if the input validate `taskId` isn't owned. GET `/voice/record-info` doubles as commit/refund site: on `status="success"` marks job completed + commits credits, on `status="fail"` marks failed + refunds. Both via `commitReservedCreditsForJob` / `refundReservedCreditsForJob` (CAS on `status='reserved'`, idempotent). Rate-limit 5/min/token on `/voice/generate`. **Stale-job sweep (audit fix):** `sweepStaleVoiceJobs` in `ee/billing/cleanup-service.ts` (cron `45 * * * *`) refunds `suno-voice-create` jobs stuck >2h in `pending/processing` (closing the abandoned-modal credit-leak hole — there's no KIE webhook fallback like character-lora), and GC's validate rows >24h. Suno music nodes (`suno-generate` / `suno-cover` / `suno-extend`) gained `personaId` + `personaModel` body fields → wired through worker → KIE API. The `suno-voice` node is registered in `SOURCE_NODE_TYPES` (`execution-graph.ts`) so the orchestrator skips execution at runtime; `output-extractor.ts` emits `{ voiceId, personaId, personaModel: "voice_persona", voiceName, style }` from `data.voiceId` AND `getPrimaryOutput` has a `case "suno-voice"` returning `output.voiceId` (without this case the orchestrator's `if (!output) continue` skipped the entire suno-voice → personaId routing block — only single-node Run worked). Frontend resolver `node-input-resolver.ts` + backend resolver `input-resolver.ts` both route `voiceId` → `personaId` when downstream is one of the 3 music nodes (no-op otherwise so the edge stays valid). Pricing seeded in migration 130 + `STATIC_CREDIT_COSTS["suno-voice-create"] = 20`. KIE does not publish pricing — value is a conservative one-time default, tune via `audit-credits` after usage data. |

---

## App Run Archive (soft-delete) — migrated from root CLAUDE.md

`app_runs.deleted_at` makes `DELETE /v1/app/:slug/runs/:runId` a soft-delete. The run is hidden from the default list and recoverable from `/archived-runs` in the UI. API / SDK (`client.apps.deleteRun()`) / MCP (`delete_app_run` tool) all soft-delete by design — they cannot destroy data.

UI-only routes (deliberately not surfaced in SDK/MCP):
- `GET  /v1/me/archived-runs` — global archive list across all apps
- `POST /v1/app/:slug/runs/:runId/restore` — un-archive
- `DELETE /v1/app/:slug/runs/:runId/permanent` — real destroy (row + workflow_executions row; R2 reaped by cleanup-cron)

Permanent delete requires the run to be archived first (returns 400 `not_archived` otherwise).
