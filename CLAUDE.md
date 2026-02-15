# CLAUDE.md Maintenance Rule

**After every commit, update this file** to reflect new features, fixes, or architecture changes.
- Bump version (patch for fixes, minor for features)
- This file is in .gitignore -- stays local only, never pushed to remote
- Full project spec is in `docs/FULL_SPEC.md` (reference only, don't load into context)

# SceneNode.ai — Claude Code Reference

## Development Conventions

### Git Workflow
- **Branch naming**: `feat/`, `fix/`, `refactor/`, `docs/` prefixes
- **Commit style**: Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`)
- **Never commit to main directly** -- always use feature branches + PR review
- Run `npx tsc --noEmit` in both frontend and backend before every commit

### Edition Architecture (Three-Tier)

| Edition | `EDITION` value | Admin Panel | Credits/Billing |
|---------|-----------------|-------------|-----------------|
| **Community** | `community` (default) | No | No |
| **Business** | `business` | Yes | No |
| **Cloud** | `cloud` | Yes | Yes |

**Backend helpers** (`backend/src/lib/config.ts`): `isCommunity()`, `isBusiness()`, `isCloud()`, `hasAdmin()`, `hasCredits()`
**Frontend helpers** (`frontend/src/lib/edition.ts`): Same names, reads `NEXT_PUBLIC_EDITION`

**Rules:**
- Never use raw `config.EDITION === "..."` -- use helper functions
- Credit-related code must be gated behind `hasCredits()`
- Admin-related code must be gated behind `hasAdmin()`

### Credit System Pattern

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

**Credit files:**
- `backend/src/billing/credits.ts` -- CreditsService (check, reserve, refund, dual-pool)
- `backend/src/middleware/credit-guard.ts` -- creditGuard preHandler + reserveCreditsForJob
- `backend/src/billing/paddle-config.ts` -- Tier/pricing constants, price ID mappings
- `backend/src/routes/paddle-webhook.ts` -- Paddle webhook handler (POST /v1/billing/paddle-webhook)
- `backend/src/billing/provision-credits.ts` -- Webhook event handlers (sub created/updated/canceled, topup)
- `backend/src/billing/cleanup-service.ts` -- R2 media cleanup
- `backend/src/billing/cleanup-cron.ts` -- Scheduled cleanup jobs

### API Proxy Architecture (CRITICAL)

All frontend API calls use **same-origin relative paths** (e.g. `/v1/billing/subscription`).
Next.js `rewrites` in `frontend/next.config.ts` proxy `/v1/*` to the backend (`http://localhost:8000`).

**Rules:**
- `API_BASE_URL` in `frontend/src/lib/api.ts` is `""` (empty string) -- NEVER hardcode `localhost:8000`
- Admin pages and hooks must also use relative `/v1/...` paths, NOT their own `API_BASE_URL`
- The backend URL is configured via `NEXT_PUBLIC_API_URL` env var in `next.config.ts` only
- This pattern eliminates mixed-content (HTTPS/HTTP) issues when using ngrok or production domains
- **Exception: SSE streaming** calls bypass the proxy and call `NEXT_PUBLIC_API_URL` directly (the proxy buffers response bodies, breaking real-time token delivery). See SSE Streaming Infrastructure below.

### CORS Configuration

Backend CORS is configured in `backend/src/app.ts` with a whitelist:
- Default origins: `http://localhost:3000`, `https://app.scenenode.ai`
- Additional origins via `CORS_ORIGIN` env var (comma-separated)
- SSE responses include CORS headers manually (in `sse.ts`) because `reply.raw.writeHead()` bypasses Fastify's `onSend` hooks where `@fastify/cors` injects headers

### Coding Standards
- **Backend**: Fastify plugin pattern (NOT Express Router)
- **Frontend**: Next.js 14 App Router + shadcn/ui + Tailwind
- **State**: React Query (server state) + Zustand (UI state) + React Flow (canvas state)
- **Validation**: Zod schemas on all API endpoints
- **Immutability**: Never mutate objects/arrays -- always create new copies
- **File size**: 200-400 lines typical, 800 max
- **No console.log in production code**

### Provider Enum Sync (CRITICAL)

**EVERY time a provider list changes for ANY node type, update ALL of these:**

| Step | File | What to Update |
|------|------|----------------|
| 1 | `frontend/src/types/nodes.ts` | TypeScript type for node data |
| 2 | `frontend/src/components/editor/config-panel.tsx` | `<SelectItem>` options |
| 3 | `backend/src/routes/<node-type>.ts` | **Zod validation schema** ⚠️ MOST COMMONLY FORGOTTEN |
| 4 | `backend/src/providers/kie/*.ts` or `replicate/*.ts` | Provider implementation |
| 5 | `backend/src/providers/kie/models.ts` | KIE model config (cost, params) |
| 6 | `backend/src/providers/kie/index.ts` or `replicate/index.ts` | `supportedModels` array |
| 7 | `backend/src/billing/credits.ts` | NODE_CREDIT_COSTS |
| 8 | `frontend/src/lib/pricing-data.ts` | MODEL_REFERENCE |
| 9 | `model_pricing` DB table | Include actual provider cost |
| 10 | `backend/src/billing/paddle-config.ts` | If pricing tiers or credit allocations change |
| 11 | `frontend/src/lib/pricing-data.ts` | PRICING_TIERS if tier features/prices change |

**Forgetting step 3 (Zod enum) has caused the same validation bug 3 times.**

### Database Rules
- RLS on all tables
- Use `SECURITY DEFINER` functions for service-role operations
- **NEVER create RLS policies on `profiles` that query `profiles`** (infinite recursion)
- Use `is_admin()` SECURITY DEFINER function for admin checks
- All credit operations must be atomic (use RPC functions with FOR UPDATE locks)

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14 (App Router), React Flow, shadcn/ui, Tailwind |
| Backend | Fastify (Node.js/TypeScript), BullMQ (Redis) |
| Database | Supabase (PostgreSQL + Auth + Realtime) |
| Storage | Cloudflare R2 (S3-compatible) |
| Auth | Supabase Auth (Google OAuth) + API Keys |
| Payments | Paddle (Merchant of Record) |

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
| image-generation | ✅ | ✅ | KIE: + grok, gpt-image |
| image-editing | ✅ | ❌ | KIE only: recraft, nano-banana-edit |
| image-to-video | ✅ | ✅ | Both: minimax, veo, kling, runway, pika, sora |
| text-to-video | ✅ | ✅ | Both: minimax, veo, kling |
| video-to-video | ✅ | ❌ | KIE only (Wan 2.6) |
| motion-transfer | ✅ | ❌ | KIE only |
| video-upscale | ✅ | ❌ | KIE only (Topaz) |
| lip-sync | ✅ | ❌ | KIE only (kling-avatar, hailuo-avatar) |
| music-generation | ✅ | ❌ | KIE only |
| text-to-speech | ✅ | ❌ | KIE only |

### Routing Logic
- `ai_provider = "replicate"` → [replicate] chain, 0% markup
- `ai_provider = "kie"` + shared capability → [kie, replicate] chain, configured markup
- `ai_provider = "kie"` + KIE-only capability → [kie] chain, configured markup

### KIE.ai Models

***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
| Image | nano-banana-pro | $0.025 | - | - |
| Image | flux | $0.03 | - | - |
| Image | grok | $0.03 | - | - |
| Image | gpt-image | $0.04 | - | - |
| Video | minimax | $0.40 | 5s | end_image_url |
| Video | veo3 | $2.00 | 8s fixed | imageUrls[] |
| Video | veo3.1 | $1.25 | 8s fixed | imageUrls[] |
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
| Lip Sync | kling-avatar | $0.40 | - | - |
| Lip Sync | hailuo-avatar | $0.35 | - | - |

### Model Identifiers (Case-Sensitive)
All use **lowercase with hyphens** except VEO which uses **dot notation**: `veo3`, `veo3.1` (NOT `veo-3` or `veo_3.1`)

### Duration Validation
- VEO3/VEO3.1: Fixed 8 seconds (no duration parameter)
- Kling/Kling-Turbo: 5 or 10 seconds
- Grok: 6 or 10 seconds
- Sora: Uses `n_frames` (10 ≈ 5s, 15 ≈ 10s)

### End Frame Support (Start + End Image → Video)
- VEO3/VEO3.1: `imageUrls: [startFrame, endFrame]`
- MiniMax: `end_image_url` parameter
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
- **Deduction order:** subscription first → then topup
- `deduct_credits` RPC handles atomic deduction with FOR UPDATE lock
- Free tier: 50 credits, 10/day cap, veo-3/sora-2-pro blocked, outputs watermarked

### Pricing
- Base formula: `1 credit ≈ $0.10 provider cost`
- Tiers: Free ($0/50cr), Basic ($19/95cr), Standard ($39/235cr), Pro ($79/530cr), Business ($149/1120cr)
- Top-ups: $10/55cr, $25/150cr, $50/330cr, $100/700cr (never expire)

### Credit Cost Per Node

| Node Type | Credits | Notes |
|-----------|---------|-------|
| generate-script | 2 | Gemini Flash |
| generate-image | 4-12 | nano-banana=4, nano-banana-pro=6, flux=10, grok=8, gpt-image=12 |
| image-to-image | 4-12 | Same as generate-image per model |
| edit-image | 4-6 | recraft-remove-bg=4, recraft-upscale=6, nano-banana-edit=6 |
| image-to-video | 1-40 | kling-turbo=1, minimax=2, kling=3, grok-i2v=3, veo3.1=12, sora2-pro=20, veo3=20 |
| text-to-video | 1-40 | Same as image-to-video |
| text-to-speech | 1 | ElevenLabs via KIE.ai |
| generate-music | 1 | Suno/MiniMax |
| text-to-audio | 1 | ElevenLabs SFX |
| ai-writer | 2 | Claude Sonnet via Anthropic API |
| qa-check | 1 | Gemini Flash |
| FFmpeg nodes | 0 | combine-videos, merge-video-audio, add-captions, resize, trim, extract-audio, mix-audio, adjust-volume |

### Credit Flow
1. Job created → Reserve credits (estimate based on model)
2. Job processing → API call to provider
3. Job completed → Commit actual credits, refund difference if overestimated
4. Job failed → Full refund of reserved credits

### Frontend Credit Components
All gated behind `hasCredits()`:
- `CreditBalance` — toolbar widget, auto-refresh 30s
- `GenerateButton` — config panel button showing cost per model, disables when insufficient
- `InsufficientCreditsModal` — balance vs required, with Upgrade/Buy CTAs
- `RunNodeButton` — hover button under each node "Run (N CR)"
- `useModelCredits(modelId)` hook — fetches from `/v1/credits/model-cost` with cache

### Watermark System (Free Tier)
- Free tier outputs get a semi-transparent "SceneNode.ai" watermark; paid tiers get clean outputs
- **Images**: Sharp SVG composite, bottom-right, font size = 2.5% of image width (min 16px)
- **Videos**: FFmpeg `drawtext` filter, white@0.5 opacity, bottom-right corner
- **NOT watermarked**: audio (TTS, music, SFX, suno-*), scripts, FFmpeg processing nodes
- Worker checks `profiles.tier` at job start; `shouldWatermark = (tier === "free")`
- Helper functions in `backend/src/utils/watermark.ts`: `applyImageWatermark(buffer)`, `applyVideoWatermark(inputPath, outputPath)`
- Worker helpers: `uploadImageMaybeWatermark`, `uploadVideoMaybeWatermark`, `watermarkLocalVideoAndUpload`
- Special case: image-to-video with audio merge -- watermark applied to FINAL merged output only

### Cost Markup (Cloud Edition)
- `displayCost = providerCost × (1 + markupPercent / 100)` (default 25%)
- Regular users see `cost` (display_cost). Provider/provider_cost hidden via `sanitizeJobForPublic()`
- Admin users see full breakdown. Self-hosted: no markup, full data visible.

---

## Billing (Paddle)

### Billing Routes (`backend/src/routes/billing.ts`)
- `GET /v1/billing/subscription?userId=...` -- Get current subscription
- `GET /v1/billing/transactions?userId=...` -- Transaction history
- `POST /v1/billing/manage-subscription` -- Paddle customer portal URL
- `POST /v1/billing/change-plan` -- Change subscription tier (calls `paddle.subscriptions.update()` with `prorated_immediately`)

### Plan Change Flow (CRITICAL -- avoids duplicate subscriptions)
- Subscribed users: pricing page calls `POST /v1/billing/change-plan` (NOT `openCheckout()`)
- New users: pricing page calls `openCheckout()` to create first subscription
- Paddle sends `subscription.updated` webhook automatically after plan change
- `handleSubscriptionUpdated()` in `provision-credits.ts` handles credit diff (upgrade grants, downgrade defers)

### Cancellation Flow (CRITICAL -- must downgrade immediately)
- `subscription.canceled` webhook fires for BOTH immediate and end-of-period cancellations
- `handleSubscriptionCanceled()` ALWAYS downgrades user to free tier immediately:
  - `tier = "free"`, `subscription_credits = min(current, 50)`, `storage_limit_bytes = 500MB`
- `expireSubscriptions` cron is a safety net only (marks subs as "expired" to prevent reprocessing)
- Topup credits are NOT affected by cancellation (they never expire)

### Webhook System
- Endpoint: `POST /v1/billing/paddle-webhook` (in `backend/src/routes/paddle-webhook.ts`)
- **Webhook URL must match deployment**: `https://{domain}/v1/billing/paddle-webhook`
- Events handled: subscription.created/updated/canceled/past_due/paused/resumed, transaction.completed/payment_failed
- All webhook writes are idempotent (check existing before insert)
- Signature verification via `paddle.webhooks.unmarshal(rawBody, secret, signature)`

### General
- `BILLING_PROVIDER=paddle` env var enables billing features
- Storage limits: Free=500MB, Basic=5GB, Standard=15GB, Pro=50GB, Business=100GB
- Retention: Active subscribers = kept. Free/canceled = 60 days grace then delete media. Workflows never deleted.
- Cleanup cron: runs hourly (expire subscriptions) and daily 3AM UTC (R2 media cleanup)
- Subscription statuses: `active` -> `canceled` (webhook) -> `expired` (cron safety net)

### Frontend Billing Pages
- `/pricing` -- Subscription-aware: shows "Current Plan" badge, "Switch Plan" for existing subscribers, normal checkout for new users
- `/billing` -- Dashboard: current plan, credit balance (subscription + topup pools), transaction history, manage subscription link
- All API calls use relative paths via Next.js proxy (see API Proxy Architecture above)

### Paddle Env Var Naming (CRITICAL -- has caused bugs twice)
Backend `.env` uses **`PADDLE_PRICE_CREDITS_55/150/330/700`** for top-ups (named by credit amount).
`paddle-config.ts` keys are `credits_55/150/330/700`. Fallbacks are actual sandbox price IDs.
NEVER use placeholder fallbacks like `"pri_topup_10"` -- always use real Paddle price IDs.

### Paddle Testing with ngrok
- Paddle rejects `localhost` -- must use ngrok for checkout + webhook testing
- Frontend: `ngrok http 3000` -- Next.js proxy handles API calls seamlessly
- Webhook URL in Paddle dashboard: `https://<ngrok-url>/v1/billing/paddle-webhook`
- Add ngrok URL to Supabase Auth > Redirect URLs: `https://*.ngrok-free.app/**`
- Google OAuth `redirectTo` already uses `window.location.origin` (in `use-auth.ts`)

---

## Gallery & Private Mode

### Public Gallery
- `GET /v1/gallery` -- public endpoint, no auth required
- Query params: `page` (default 1), `limit` (default 20, max 50), `type` (image/video/audio)
- Returns completed public jobs with username (never exposes user_id/email)
- Maps job names to output types via Sets: IMAGE_JOBS, VIDEO_JOBS, AUDIO_JOBS
- Frontend: `/gallery` standalone page (outside dashboard layout) with grid, filter tabs, pagination, dialog preview

### Private Mode
- `GET /v1/user/settings?userId=` -- returns tier + publicOutputs
- `PATCH /v1/user/settings` -- updates public_outputs with tier enforcement
- Only Standard/Pro/Business can set `publicOutputs = false` (Free/Basic always public)
- Frontend: Settings page has Gallery Visibility toggle card
- Worker sets `is_public` flag on jobs during processing based on user's `public_outputs` profile setting

### Key Files
- `backend/src/routes/gallery.ts` -- Gallery API route
- `backend/src/routes/user-settings.ts` -- User settings API route
- `backend/src/utils/watermark.ts` -- Watermark functions (sharp + ffmpeg)
- `frontend/src/app/gallery/page.tsx` -- Gallery page
- `frontend/src/app/(dashboard)/settings/page.tsx` -- Settings page with visibility toggle
- `supabase/migrations/011_gallery_and_private_mode.sql` -- DB migration (public_outputs on profiles, is_public on jobs, gallery index, RLS policy)

### Database Additions
- `profiles.public_outputs` (boolean, default true) -- user preference for gallery visibility
- `jobs.is_public` (boolean, default true) -- per-job visibility flag set at processing time
- `idx_jobs_public_gallery` -- partial index on `(is_public, status, completed_at DESC)` WHERE `is_public = true AND status = 'completed'`
- RLS policy "Public gallery read" on `jobs` FOR SELECT USING `is_public = true AND status = 'completed'`

---

## AI Writer Node (v1.22)

### Overview
AI Writer generates multiple image prompts from a single concept, then spawns individual Generate Image nodes on the canvas. Uses Claude Sonnet via Anthropic API (2 credits per generation).

### Workflow
1. Connect a **reference image** (Generate Image, Upload Image, etc.) to AI Writer for visual consistency
2. Optionally connect a **Face** node for facial identity
3. Select a template (Photo Shoot, Product Catalog, Storyboard) or use Custom
4. Run AI Writer -- generates N prompts separated by `===NEXT===`
5. Click "Create N Image Nodes" -- spawns individual Generate Image nodes in 2-column grid
6. Each node receives: prompt text + reference image edges + face edge
7. Click "Generate All N Images" -- runs all with concurrency limit of 3

### Key Files
- `backend/src/routes/ai-writer.ts` -- POST `/v1/ai-writer/generate` (Claude API, 120s timeout)
- `frontend/src/lib/ai-writer-templates.ts` -- 3 built-in templates + Custom
- `frontend/src/components/nodes/ai-writer-node.tsx` -- Node component with preview modal
- `frontend/src/lib/api.ts` -- `generateAIWriter()` (bypasses Next.js proxy for long requests)

### Architecture Notes
- Templates use `{outputCount}` placeholder replaced at runtime
- Predefined templates require a connected reference image; Custom does not
- Created nodes tracked via `createdNodeIds` on AIWriterNodeData for cleanup on re-creation
- Store functions: `createNodesFromWriter` + `runAllWriterImageNodes` (registered via useEffect pattern)
- `handleCreateNodesFromWriter()` uses `getImageOutputHandle()` for correct source handle IDs per node type
- Prompt truncation: 1500 chars at node creation, 2000 chars after wrapper expansion (character descriptions)
- `AI_WRITER_BASE_URL` calls backend directly (not via Next.js proxy) to avoid 30s timeout

### Output Handle Map (for edge creation)
| Node Type | Output Handle |
|-----------|---------------|
| generate-image / upload-image | `"image"` |
| edit-image / image-to-image | `"out"` |
| character | `"characterRef"` |
| object | `"objectRef"` |
| location | `"locationRef"` |
| face | `"faceRef"` |

---

## Database Tables

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `profiles` | id, email, tier, subscription_credits, topup_credits, daily_spent_credits, storage_used_bytes, storage_limit_bytes, role, public_outputs | Extends auth.users |
| `projects` | id, user_id, name, settings | |
| `workflows` | id, project_id, user_id, nodes (JSONB), edges (JSONB), source_prompt | React Flow data |
| `jobs` | id, workflow_id, user_id, status, progress, input_data, output_data, provider, provider_cost, is_public | Execution records |
| `assets` | id, user_id, job_id, type, r2_key, r2_url, size_bytes | Generated files |
| `characters` | id, project_id, name, description, reference_image_url, visual_traits (JSONB) | Per-project |
| `style_presets` | id, name, settings (JSONB), is_system, user_id | System + user-created |
| `usage_logs` | id, user_id, job_id, action, provider, credits_used, cost_usd | Billing audit |
| `model_pricing` | model_identifier (PK), credit_cost, is_enabled, tier_restriction | Credit costs |
| `app_settings` | key (unique), value (JSONB) | ai_provider, cost_markup_percent |
| `credit_transactions` | id, user_id, amount, credit_type, source, job_id | Audit log |
| `paddle_customers` | id, user_id, paddle_customer_id | Supabase ↔ Paddle mapping |
| `subscriptions` | id, paddle_subscription_id, paddle_price_id, tier, status, current_period_start, current_period_end, canceled_at, updated_at | Synced from Paddle |
| `transactions` | id, paddle_transaction_id, type, amount_usd, credits_granted | Payment history |

---

## Project Structure

```
frontend/src/
  app/(auth)/             — Login, signup
  app/(dashboard)/        — Projects list, workflow list
  app/(admin)/            — Admin panel (cloud/business only)
  app/editor/             — React Flow editor
  app/pricing/            — Pricing page (Paddle)
  app/billing/            — Billing dashboard
  app/gallery/            — Public community gallery
  components/nodes/       — 30+ custom node components
  components/credits/     — CreditBalance, GenerateButton, etc.
  components/ui/          — shadcn/ui
  hooks/                  — useModelCredits, etc.
  lib/api.ts              — API client
  lib/ai-writer-templates.ts — AI Writer templates + system prompts
  lib/paddle.ts           — Paddle.js singleton
  lib/edition.ts          — Edition helpers
  lib/pricing-data.ts     — Tier/model pricing constants
  types/nodes.ts          — Node data types

backend/src/
  server.ts               — Entry point
  app.ts                  — Fastify app + route registration
  worker.ts               — BullMQ job processor (video-worker)
  routes/                 — API routes (jobs, workflows, projects, admin-*, billing, gallery, user-settings, ai-writer)
  utils/watermark.ts      — Image + video watermark functions
  providers/              — AI provider abstraction (see Provider System above)
  billing/                — Credits, Paddle, cleanup (see Credit System above)
  middleware/             — credit-guard.ts, auth
  lib/config.ts           — Env config + edition helpers
  lib/app-settings.ts     — Settings cache (60s TTL)
```

---

## UI / Styling

**Accent Color**: `#ff0073` (pink) — primary buttons, active states, node animations, save button, sidebar active border.

**Dark Mode**: bg #121212, card #1E1E1E, border #2D2D2D, text #F8FAFC
**Light Mode**: bg #F8FAFC, card #FFFFFF, border #E2E8F0, text #1E293B

**Node Colors (MiniMap):** AI=purple, Input=blue, Parameter=indigo, Processing=amber, Output=green, Character=pink, Object=emerald, Location=cyan, Scene=violet, Sticky=yellow

---

## SSE Streaming Infrastructure

**File:** `backend/src/lib/sse.ts`

Reusable Server-Sent Events helper for Fastify. Used by any endpoint that needs to stream data to the browser (AI Writer, future AI Flow Builder, etc).

### Usage
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

### SSE Controller API
| Method | Description |
|--------|-------------|
| `sendEvent(event)` | Send a structured `StreamEvent` as `data: JSON\n\n` |
| `sendComment(text?)` | Send SSE comment (`: text\n\n`), used for keepalive |
| `close()` | End the stream, clear keepalive timer |
| `isClosed` | Boolean — true after close() or client disconnect |

### Event Protocol (`StreamEvent`)
| Type | Fields | Purpose |
|------|--------|---------|
| `token` | `data: string` | Incremental text chunk (LLM streaming) |
| `metadata` | `data: Record<string, unknown>` | Model info, usage stats, etc. |
| `progress` | `step, total, message` | Step-based progress indicator |
| `done` | `data: Record<string, unknown>` | Final result payload |
| `error` | `data: { code, message }` | Error with machine-readable code |

### Behavior
- Sets headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`
- Adds `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials` from request `Origin` header (bypasses `@fastify/cors` since `reply.raw.writeHead()` skips Fastify hooks)
- Auto keepalive comment every 15s to prevent proxy/CDN timeout
- Cleans up on `close()` or client disconnect (`req.raw.on('close')`)
- All writes are no-ops after close (safe to call `sendEvent` on a closed stream)

### Frontend SSE Client (`frontend/src/lib/sse-client.ts`)

Reusable async generator for consuming SSE from POST requests (native `EventSource` only supports GET).

```typescript
import { streamRequest, type StreamEvent } from "@/lib/sse-client"

const controller = new AbortController()

for await (const event of streamRequest("/v1/ai-writer/generate-stream", {
  body: { systemPrompt, userInput, userId, model },
  signal: controller.signal,
})) {
  switch (event.type) {
    case "metadata": console.log("Job:", event.data.jobId); break
    case "token":    output += event.data; break
    case "done":     console.log("Complete:", event.data); break
    case "error":    console.error(event.data.message); break
  }
}

// Cancel mid-stream:
controller.abort()
```

- Uses `fetch()` + `ReadableStream.getReader()` + `TextDecoder`
- Accepts optional `baseUrl` to bypass Next.js proxy (calls backend directly for real-time SSE)
- Buffers partial chunks across reads (SSE data may split mid-line)
- Skips SSE comments (`:` prefix) and empty lines
- Supports `AbortSignal` for cancellation
- Throws on non-200 responses with status + body text
- Exports `StreamEvent` type (same shape as backend)

### Streaming API Function (`frontend/src/lib/api.ts`)

`generateAIWriterStream()` -- high-level wrapper around `streamRequest()` for the AI Writer:

```typescript
import { generateAIWriterStream } from "@/lib/api"

const { jobId, generatedText } = await generateAIWriterStream({
  systemPrompt, userInput, model, temperature, maxTokens, userId,
  onToken: (token) => { output += token; setText(output) },
  signal: abortController.signal,
})
```

- Calls `POST /v1/ai-writer/generate-stream` via SSE (bypasses Next.js proxy using `NEXT_PUBLIC_API_URL`)
- `onToken` callback fires for each streamed text delta
- Returns `{ jobId, generatedText }` on `done` event
- Throws on `error` event
- On abort (`signal`): returns gracefully with whatever text was collected so far

### AI Writer Node Streaming UX (`frontend/src/components/nodes/ai-writer-node.tsx`)

The AI Writer node uses streaming when the user clicks Run directly on the node:

- **Idle**: Dashed placeholder with FileText icon
- **Streaming**: Tokens appear in real-time in the output area with blinking cursor `|`. Stop button (red Square) visible inside the node. Preview modal disabled during streaming. RunNodeButton hidden (isRunning=true).
- **Completed**: Final text saved to `generatedResults` + `generatedItems` (same format as sync path). Preview modal re-enabled. Result thumbnails show for multi-result history.
- **Failed**: Error state with AlertCircle icon + error message
- **Stopped (abort)**: `generateAIWriterStream` returns partial text gracefully. The node treats this as an error with "Generation failed" message since partial output isn't useful for AI Writer (it needs all items separated by `===NEXT===`).

**Key implementation details:**
- `handleStreamingRun` bypasses `runSingleNode` from the store -- calls `generateAIWriterStream` directly
- Resolves connected text-prompt node input (same logic as `workflow-editor.tsx`)
- Processes `{outputCount}` placeholder in system prompt before sending
- Tokens accumulate in `accumulatedTextRef` (ref) and flush to Zustand store (`generatedText`) via `requestAnimationFrame` (~60fps). This lets both the node card and config panel display streaming text in real-time.
- `activeResultIndex` set to `-1` at streaming start so stale results don't override streaming text
- Uses `useRef<AbortController>` for stop; `isStreaming` state drives cursor + stop button
- Config panel shows "Streaming..." section with live text + blinking cursor when `executionStatus === "running"`
- Saves results identically to the sync path: `generatedText`, `generatedItems` (separator split), `generatedResults` array

### Workflow Execution Streaming (`workflow-editor.tsx` `executeNode`)

The DAG executor also uses `generateAIWriterStream()` for ai-writer nodes:
- `onToken` callback updates `generatedText` in the Zustand store, so the node UI shows real-time tokens even during full workflow execution
- At execution start, `activeResultIndex` is set to `-1` and `generatedText` cleared so the node displays streaming text instead of a stale old result
- After completion, `activeResultIndex: 0` is restored and `generatedResults` updated (same format as before)
- The promise returned by `generateAIWriterStream()` is awaited, so downstream nodes don't execute until streaming finishes
- Output to downstream nodes is identical to the old sync path (`generatedText` + `generatedItems`)

### Streaming Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/ai-writer/generate` | POST | Legacy sync endpoint (returns full JSON) |
| `/v1/ai-writer/generate-stream` | POST | SSE streaming endpoint (returns event stream) |

Both endpoints share the same Zod schema (`aiWriterBody`), credit guard, and job lifecycle. The streaming endpoint uses `anthropic.messages.stream()` + `on("text")` events.

### Adding Streaming to New Features

To add SSE streaming to a new backend endpoint:

1. **Backend route**: Import `createSSEStream` from `../lib/sse.js`. After validation/auth/credit checks, call `createSSEStream(req, reply)` to get the controller. Send `metadata`, then stream `token` events, then `done`/`error`. Handle errors with `sse.sendEvent({ type: "error", ... })` + `sse.close()`.
2. **Frontend API function**: Create a wrapper in `api.ts` that calls `streamRequest()` from `sse-client.ts` with the endpoint URL. Handle `token`/`done`/`error` events. Accept an `onToken` callback and `AbortSignal`.
3. **Node component**: Add `accumulatedTextRef` + `flushTimerRef` refs + `AbortController` ref. In `onToken`, accumulate text in the ref and flush to Zustand store via `requestAnimationFrame` (throttles to ~60fps). Set `activeResultIndex: -1` at start so the store's `generatedText` drives display. Add `isStreaming` state for cursor + stop button.

---

## Technical Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Backend language | TypeScript (Node.js) | Same as frontend, BullMQ native |
| Backend framework | Fastify | Fast, TypeScript-first, plugin system |
| Job queue | BullMQ | Best for Node.js, excellent dashboard |
| Execution model | Frontend DAG engine | Topological sort, parallel per level |
| Realtime updates | Polling (MVP) → SSE (Phase 2) | No extra infra needed |
| Audio processing | FFmpeg in worker | All audio nodes use FFmpeg, not AI |
| Translation | Gemini Flash via Replicate | Creative prompt translation |
| Settings cache | 60s TTL | Reduce DB queries for app_settings |

---

## Storage Management (v1.22)

### Single Source of Truth
- `TIER_STORAGE_LIMITS` in `backend/src/billing/paddle-config.ts` defines per-tier storage quotas (Free=500MB, Basic=5GB, Standard=15GB, Pro=50GB, Business=100GB)
- `checkStorageLimit()` in `CreditsService` reads `storage_limit_bytes` from DB first (supports admin overrides), falls back to `TIER_STORAGE_LIMITS[tier]`
- Storage enforcement: `creditGuard` middleware checks storage before credits (HTTP 413 `storage_limit_exceeded`)

### StorageExceededModal
- `frontend/src/components/credits/StorageExceededModal.tsx` -- Reusable modal showing used/quota/remaining with progress bar
- Shown on **upload errors** (via `useFileUpload` hook in upload-image/audio/video nodes)
- Shown on **execution errors** (via `isStorageError()` helper in `workflow-editor.tsx` catching `StorageExceededError`)
- Two CTAs: "Upgrade Plan" (/pricing) and "Manage Files" (/library)

### StorageExceededError
- Custom error class in `frontend/src/lib/api.ts` with `usedBytes`, `quotaBytes`, `remainingBytes`, `tier`
- `throwApiError()` helper detects `storage_limit_exceeded` from API JSON responses and throws `StorageExceededError`
- `useFileUpload` hook detects HTTP 413 responses and exposes `storageExceeded` state

### Library Page
- `frontend/src/app/(dashboard)/library/page.tsx` -- User file management with storage summary
- Features: filter tabs (all/image/video/audio), file grid with thumbnails, multi-select delete, cursor-based pagination
- API: `GET /v1/library?userId=...&owned=true` (only user's own files), `DELETE /v1/library/:id?userId=...`
- Sidebar: "Library" nav item with Archive icon between Gallery and Pricing

### Admin Storage Controls
- `PUT /v1/admin/users/:id/storage` -- Admin can override storage limit per user
- `GET /v1/admin/users` -- Returns storage_used_bytes + storage_limit_bytes for each user
- Admin Users page shows storage bar per user with edit capability

### Key Files
- `backend/src/billing/paddle-config.ts` -- `TIER_STORAGE_LIMITS`
- `backend/src/billing/credits.ts` -- `checkStorageLimit()` (DB-first, fallback to tier)
- `backend/src/middleware/credit-guard.ts` -- Storage check before credit check
- `backend/src/routes/library.ts` -- Library CRUD + `owned` query param
- `backend/src/routes/admin-credits.ts` -- Admin storage management endpoints
- `frontend/src/components/credits/StorageExceededModal.tsx` -- Modal component
- `frontend/src/hooks/use-file-upload.ts` -- Upload hook with storage error detection
- `frontend/src/app/(dashboard)/library/page.tsx` -- Library page
- `frontend/src/app/(dashboard)/billing/page.tsx` -- Billing page storage section

---

## List Infrastructure (v1.25) -- COMPLETE

**Phase 1: AI Writer cleanup** -- Removed auto-chunking from AI Writer. Single LLM call per run, 1 credit, maxTokens 4096. SSE streaming kept intact.

**Phase 2: List Node** -- New "list" input node (category: input, 0 credits). User enters items one per line. Dynamic config panel with add/edit/delete per row. Added to both toolbars, nodeTypes, config panel.

**Phase 3a: Execution engine list support** -- `extractNodeOutputAsList()` returns all items as `string[]`. `getListInputForNode()` checks if node receives list input from upstream (>1 items). Added `"list"` case in `resolveNodeInputs`.

**Phase 3b: List propagation (AI Writer)** -- `executeNodeForList()` runs AI Writer sequentially per list item with progress tracking (`__listTotal`/`__listCompleted`/`__listResults`).

**Phase 3c: List propagation for all nodes** -- Extended to all node types. `executeNode` accepts optional `overridePrompt` parameter (prompt passed directly, no store mutation). Generate Image: `overridePrompt` takes priority over `inputs.prompt`. `handleRunSingleNode` also checks for list input and routes to `executeNodeForList`. Works for both "Execute workflow" and "Run This Node" buttons.

**Phase 4: List UI badges and progress** -- xN badge (cyan pill) on nodes connected to list input showing iteration count. Running counter badge (fuchsia pill, animated) showing "2/3" during execution. Progress bar with gradient (cyan-to-fuchsia) and percentage during list execution. Renamed "Asset Library" to "My Library" across all UI.

**Phase 5: Expand/Collapse Clones** -- After list execution, `expandLoopResults()` creates visual clones (e.g., `node_7_iter_0`) for each list result. Originals are hidden (`hidden: true`), not deleted. Clones are marked with `data.__expandedClone: true` and `data.__expandedFrom: originalNodeId`. Before any execution (`handleRun`, `handleRunFromHere`, `handleRunSelected`), `collapseExpandedClones()` removes clones, unhides originals, and restores clean graph for BFS/execution. Clone detection uses BOTH `__expandedClone` flag AND `/_iter_\d+$/` ID pattern (backwards compat).

**Phase 6: Run Selected** -- Multi-select nodes on canvas, floating action bar appears above selection with "Run selected (N)" button. Right-click context menu also shows "Run selected" when 2+ nodes selected. `handleRunSelected()` collects selected executable nodes, collapses clones, builds execution levels from selection subset, runs topological sort within selection only.

### Key Functions (workflow-editor.tsx)
| Function | Purpose |
|----------|---------|
| `collapseExpandedClones()` | Pre-execution: remove clones, unhide originals, restore clean graph |
| `expandLoopResults()` | Post-execution: create visual clones from `__listResults`, hide originals |
| `handleRunFromHere(nodeId)` | BFS forward from node, collapse first, execute downstream subgraph |
| `handleRunSelected()` | Execute only selected nodes in topological order |
| `executeNodeForList()` | Run a node N times for each list item with progress tracking |
| `getEffectivelySkippedIds()` | Compute skipped nodes + downstream propagation (fixed-point) |

### Clone Expand/Collapse Lifecycle
1. **List execution completes** -> `expandLoopResults()` creates `_iter_N` clones with individual results
2. Originals hidden, clones visible with result data (images, text, etc.)
3. **Next execution triggered** -> `collapseExpandedClones()` removes ALL clones, unhides originals
4. Clean graph used for BFS traversal and topological sort
5. After execution, `expandLoopResults()` creates fresh clones from new results

### Run Selected Components
- `frontend/src/components/editor/selection-action-bar.tsx` -- Floating bar above multi-selection
- `frontend/src/components/editor/node-context-menu.tsx` -- "Run selected" context menu item
- `frontend/src/hooks/use-workflow-store.ts` -- `runSelected` / `setRunSelected` store fields

**Known issue:** `generatedResults` may accumulate across runs (cosmetic, does not affect execution).

---

## Loop Node (v1.26)

**Status: COMPLETE** (branch: feature/loop-node, merged to main)

Loop Node (Phase L1+L2): Table editor with dynamic columns/handles, execution engine that feeds column values to downstream nodes. Supports manual table input and connected mode (upstream node auto-populates rows by splitting text on newlines).

### Key Files
- `frontend/src/components/nodes/loop-node.tsx` -- Node component with dynamic handles via `useUpdateNodeInternals`
- `frontend/src/types/nodes.ts` -- `LoopColumn`, `LoopNodeData` types
- `frontend/src/components/editor/config-panel.tsx` -- `LoopConfig` table editor (add/remove columns+rows, rename headers, edit cells)
- `frontend/src/components/editor/workflow-editor.tsx` -- `getListInputForNode` + `resolveNodeInputs` Loop cases

### Architecture
- **Manual mode**: User defines columns (each = output handle) and rows in a table. Each column handle feeds its column values as a list to downstream nodes.
- **Connected mode**: Upstream node wires to Loop's `"in"` handle. Loop reads upstream output, splits by `\n`, uses lines as iteration items (overrides manual table).
- Reuses existing List execution path: `getListInputForNode` -> `executeNodeForList` (runs downstream N times).
- `edge.sourceHandle` resolves which column feeds which downstream node.
- Dynamic handles require `useUpdateNodeInternals` hook (React Flow v12 doesn't auto-detect new `<Handle>` components).
- Handle positions distributed within body area (42%-88%) to avoid header overlap.

---

## Skip Node (v1.20)

**Status: COMPLETE** (branch: feat/skip-node, merged to main)

Right-click or multi-select to skip/unskip nodes. Skipped nodes and their dependents are excluded from execution. Visual: opacity-40 + dashed border + orange SKIP badge. Runtime-only flag (`data.skipped`), not persisted to DB.

### Key Changes
- `frontend/src/hooks/use-workflow-store.ts` -- `toggleSkipNode`, `skipSelectedNodes`, `unskipSelectedNodes` store actions
- `frontend/src/components/editor/node-context-menu.tsx` -- Skip/Unskip toggle in right-click menu
- `frontend/src/components/editor/selection-action-bar.tsx` -- Bulk Skip/Unskip button for multi-select
- `frontend/src/components/nodes/base-node.tsx` -- `opacity-40 border-dashed` + orange SKIP badge when `data.skipped`
- `frontend/src/components/editor/workflow-editor.tsx` -- `getEffectivelySkippedIds()` helper + skip filtering in `handleRun`, `handleRunFromHere`, `handleRunSelected`

### Effective Skip Propagation
`getEffectivelySkippedIds(nodes, edges)` computes the full set of effectively skipped nodes:
1. Directly skipped nodes (`data.skipped === true`)
2. Nodes whose ALL parents are effectively skipped (cascading propagation via fixed-point iteration)
3. Nodes with at least one non-skipped parent still execute normally

---

## Architecture Documentation (v1.21)

Auto-generated architecture docs via `scripts/generate-architecture.ts`. Produces 4 output files:

| File | Content | Git-tracked |
|------|---------|-------------|
| `ARCHITECTURE.md` | Full internal architecture (all routes, tables, billing) | No (.gitignored) |
| `ARCHITECTURE.public.md` | Filtered for Community edition (no admin/billing/paddle) | Yes |
| `architecture-graph.html` | Interactive D3.js force-directed import graph (all files) | No (.gitignored) |
| `architecture-graph.public.html` | Filtered graph (no billing/admin/paddle nodes) | Yes |

**Command:** `npx tsx scripts/generate-architecture.ts`

### What the script scans
- Project structure (frontend/src, backend/src directory trees)
- API routes (from `app.ts` route registrations)
- Database tables (from Supabase migrations)
- Node types (from `NODE_DEFINITIONS` in workflow store)
- AI providers (from provider registry)
- Import graph (all `.ts`/`.tsx` files, resolves `@/` aliases + relative imports)
- Edition gating (from config helpers)

### Public version filtering
- Routes: excludes `/v1/admin/*`, `/v1/billing/*`, paddle-related
- Tables: excludes `subscriptions`, `transactions`, `paddle_customers`, `credit_transactions`, `app_settings`
- Project structure: hides `backend/src/billing/` directory
- Import graph: excludes nodes with `billing`/`admin`/`paddle`/`gallery-reports` in path
- Edition gating section: excluded entirely

---

## Active TODOs
- [x] Phase 7: Paddle sandbox testing (verified: subscriptions, top-ups, webhooks, billing page)
- [ ] Phase 7: Paddle production go-live (swap sandbox keys for production)
- [x] Run only specific node in workflow (Run This Node + Run from here + Run Selected)
- [x] Skip node in specific run
- [x] ARCHITECTURE.md / Code Graph (auto-generated, 4 output files)
- [x] Storage sync + management (quota enforcement, library page, admin controls, StorageExceededModal)
- [x] UI fixes: admin race condition (roleLoaded), theme toggle (resolvedTheme), new project/workflow auto-navigate, grok duration 10s only, play/pause icons
- [ ] Version history per node
- [ ] Video generation with start+end frames (2 images → video) for supporting models
- [ ] /v1/available-models endpoint (filter by edition + API keys)
- [ ] TTS voice browser with categories, search, audio previews
- [ ] Translation: use AI (Gemini/Claude) not Google Translate
- [ ] Build from Prompt: MVP + Director Mode versions
- [ ] Scene Node + Shot Node as optional "Director Mode"

---

*Last updated: 2026-02-14*
*Version: 1.22.0*
