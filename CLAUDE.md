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

**Credit files:** `billing/credits.ts` (CreditsService), `middleware/credit-guard.ts` (preHandler + reserve), `billing/paddle-config.ts` (tiers/pricing), `routes/paddle-webhook.ts` (webhook handler), `billing/provision-credits.ts` (webhook event handlers), `billing/cleanup-service.ts` + `cleanup-cron.ts` (R2 media cleanup)

### API Proxy Architecture (CRITICAL)

All frontend API calls use **same-origin relative paths** (e.g. `/v1/billing/subscription`).
Next.js `rewrites` in `frontend/next.config.ts` proxy `/v1/*` to the backend (`http://localhost:8000`).

**Rules:**
- `API_BASE_URL` in `frontend/src/lib/api.ts` is `""` (empty string) -- NEVER hardcode `localhost:8000`
- Admin pages and hooks must also use relative `/v1/...` paths, NOT their own `API_BASE_URL`
- The backend URL is configured via `NEXT_PUBLIC_API_URL` env var in `next.config.ts` only
- **Exception: SSE streaming** calls bypass the proxy and call `NEXT_PUBLIC_API_URL` directly (proxy buffers responses, breaking real-time delivery)

### CORS Configuration
- Backend CORS in `backend/src/app.ts`: whitelist `http://localhost:3000`, `https://app.scenenode.ai`, plus `CORS_ORIGIN` env var (comma-separated)
- SSE responses include CORS headers manually (in `sse.ts`) because `reply.raw.writeHead()` bypasses Fastify's `onSend` hooks

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
| Video | grok-i2v | $0.30 | 10s | No |
***REDACTED-OSS-SCRUB***
| Lip Sync | kling-avatar | $0.40 | - | - |
| Lip Sync | hailuo-avatar | $0.35 | - | - |

### Model Identifiers (Case-Sensitive)
All use **lowercase with hyphens** except VEO which uses **dot notation**: `veo3`, `veo3.1` (NOT `veo-3` or `veo_3.1`)

### Duration Validation
- VEO3/VEO3.1: Fixed 8 seconds (no duration parameter)
- Kling/Kling-Turbo: 5 or 10 seconds
- Grok: 10 seconds only
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
- Tiers: Free ($0/50cr), Basic ($24mo/$19yr per mo/95cr), Standard ($49mo/$39yr/235cr), Pro ($99mo/$79yr/530cr), Business ($189mo/$149yr/1120cr)
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
- Free tier: semi-transparent "SceneNode.ai" watermark; paid tiers: clean outputs
- **Images**: Sharp SVG composite, bottom-right, font size = 2.5% of width (min 16px)
- **Videos**: FFmpeg `drawtext` filter, white@0.5 opacity, bottom-right
- **NOT watermarked**: audio, scripts, FFmpeg processing nodes
- Worker checks `profiles.tier` at job start; `shouldWatermark = (tier === "free")`
- Helpers in `backend/src/utils/watermark.ts`: `applyImageWatermark(buffer)`, `applyVideoWatermark(inputPath, outputPath)`
- Worker helpers: `uploadImageMaybeWatermark`, `uploadVideoMaybeWatermark`, `watermarkLocalVideoAndUpload`
- Special case: image-to-video with audio merge -- watermark applied to FINAL merged output only

### Cost Markup (Cloud Edition)
- `displayCost = providerCost × (1 + markupPercent / 100)` (default 25%)
- Regular users see `cost` (display_cost). Provider/provider_cost hidden via `sanitizeJobForPublic()`
- Admin users see full breakdown. Self-hosted: no markup, full data visible.

---

## Billing (Paddle)

### Billing Routes (`backend/src/routes/billing.ts`)
- `GET /v1/billing/subscription?userId=...` -- Current subscription
- `GET /v1/billing/transactions?userId=...` -- Transaction history
- `POST /v1/billing/manage-subscription` -- Paddle customer portal URL
- `POST /v1/billing/change-plan` -- Change tier (`paddle.subscriptions.update()` with `prorated_immediately`)

### Plan Change Flow (CRITICAL -- avoids duplicate subscriptions)
- Subscribed users: pricing page calls `POST /v1/billing/change-plan` (NOT `openCheckout()`)
- New users: pricing page calls `openCheckout()` to create first subscription
- Paddle sends `subscription.updated` webhook automatically after plan change
- `handleSubscriptionUpdated()` in `provision-credits.ts` handles credit diff

### Cancellation Flow (CRITICAL -- must downgrade immediately)
- `subscription.canceled` webhook fires for BOTH immediate and end-of-period cancellations
- `handleSubscriptionCanceled()` ALWAYS downgrades to free tier immediately: `tier = "free"`, `subscription_credits = min(current, 50)`, `storage_limit_bytes = 1GB`
- `expireSubscriptions` cron is a safety net only
- Topup credits are NOT affected by cancellation

### Webhook System
- Endpoint: `POST /v1/billing/paddle-webhook` (in `backend/src/routes/paddle-webhook.ts`)
- **Webhook URL must match deployment**: `https://{domain}/v1/billing/paddle-webhook`
- Events: subscription.created/updated/canceled/past_due/paused/resumed, transaction.completed/payment_failed
- All writes are idempotent; signature verification via `paddle.webhooks.unmarshal(rawBody, secret, signature)`

### General
- `BILLING_PROVIDER=paddle` env var enables billing features
- Storage limits: Free=1GB, Basic=10GB, Standard=25GB, Pro=50GB, Business=200GB
- Retention: Active = kept. Free/canceled = 60 days grace then delete media. Workflows never deleted.
- Cleanup cron: hourly (expire subs), daily 3AM UTC (R2 media cleanup)
- Frontend pages: `/pricing` (subscription-aware), `/billing` (dashboard with credit balance, storage, transactions)

### Paddle Env Var Naming (CRITICAL -- has caused bugs twice)
Backend `.env` uses **`PADDLE_PRICE_CREDITS_55/150/330/700`** for top-ups (named by credit amount).
`paddle-config.ts` keys are `credits_55/150/330/700`. Fallbacks are actual sandbox price IDs.
NEVER use placeholder fallbacks like `"pri_topup_10"` -- always use real Paddle price IDs.

### Paddle Testing with ngrok
- Paddle rejects `localhost` -- must use ngrok for checkout + webhook testing
- Frontend: `ngrok http 3000` -- Next.js proxy handles API calls seamlessly
- Webhook URL: `https://<ngrok-url>/v1/billing/paddle-webhook`
- Add ngrok URL to Supabase Auth > Redirect URLs: `https://*.ngrok-free.app/**`

---

## Storage & Library (v1.22.0)

**Quota Enforcement:**
- DB-first: `storage_limit_bytes` in profiles takes precedence (admin override)
- Falls back to `TIER_STORAGE_LIMITS[tier]` from `paddle-config.ts`
- Self-hosted (`hasCredits() = false`): no enforcement
- Checked in `credit-guard.ts` + upload routes

**StorageExceededModal:**
- `StorageExceededError` class in `api.ts` with `throwApiError()` (~60 throw sites)
- `workflow-editor.tsx` catches on all 14+ API calls (shows modal not toast); `use-file-upload.ts` catches for uploads

**Admin Storage:** `PUT /v1/admin/users/:id/storage` -- progress bar + tier presets + custom GB

***REDACTED-OSS-SCRUB***

**Library Page** (`/library`): Storage summary bar, filter tabs (All/Images/Videos/Audio), thumbnails + type badges + sizes + dates, multi-select + bulk delete, cursor pagination.
Files: `frontend/src/app/(dashboard)/library/page.tsx`, `backend/src/routes/library.ts`

---

## UI Fixes (v1.23.0)

1. Admin Layout Race Condition -- `setTimeout(500)` -> deterministic `roleLoaded` from use-auth.ts
2. Theme Toggle First-Click -- `theme` -> `resolvedTheme`
3. New Project Auto-Navigate -- skip dialog, create "Untitled Project" + navigate
4. New Workflow Auto-Navigate -- async handleNewWorkflow + navigate
5. Grok Duration -- removed 6s, 10s only
6. Play/Pause Icon -- Video/VideoOff -> Play/Pause

---

## Gallery & Private Mode

### Public Gallery
- `GET /v1/gallery` -- public, no auth. Params: `cursor`, `limit` (default 20, max 50), `type` (image/video/audio)
- Returns `{ data, nextCursor }` — cursor-based pagination
- Frontend: `/gallery` standalone page with grid, filter tabs, dialog preview

### Private Mode
- `GET /v1/user/settings?userId=` / `PATCH /v1/user/settings` -- tier + publicOutputs
- Only Standard/Pro/Business can set `publicOutputs = false` (Free/Basic always public)
- Worker sets `is_public` flag on jobs during processing based on user's `public_outputs` profile setting

### DB Additions
- `profiles.public_outputs` (boolean, default true), `jobs.is_public` (boolean, default true)
- `idx_jobs_public_gallery` -- partial index WHERE `is_public = true AND status = 'completed'`
- Key files: `routes/gallery.ts`, `routes/user-settings.ts`, `app/gallery/page.tsx`, `app/(dashboard)/settings/page.tsx`
### Key Files
- `backend/src/routes/gallery.ts` -- Gallery API route
- `backend/src/routes/user-settings.ts` -- User settings API route
- `backend/src/utils/watermark.ts` -- Watermark functions (sharp + ffmpeg)
- `frontend/src/app/gallery/page.tsx` -- Gallery page
- `frontend/src/app/(dashboard)/settings/page.tsx` -- Settings page with visibility toggle
- `supabase/migrations/011_gallery_and_private_mode.sql` -- DB migration (public_outputs on profiles, is_public on jobs, gallery index, RLS policy)

### Gallery Lightbox (v1.25.0)

Full-featured lightbox for gallery items with navigation, download, fullscreen, and reference media.

**Features:**
- Arrow navigation (click + keyboard ArrowLeft/ArrowRight) between gallery items
- Download proxy: `GET /v1/download?url=...` streams R2 files with `Content-Disposition: attachment` (domain-locked to R2 bucket)
- CSS fullscreen overlay (separate `fixed` div, z-[9999], independent of Radix Dialog) with minimize/close/download buttons
- Model name badge shows `inputData.provider` (model identifier like "nano-banana") over `job.provider` (provider name like "kie")
- Report dialog (public, IP-deduplicated) + admin delete (soft-delete via `is_public = false`)

**Reference Media (input sources):**
- Avatar-stack thumbnails in meta section (w-10 h-10 rounded-full, overlapping with negative margin, +N indicator for >4)
- Click thumbnail opens separate Radix Dialog (not custom overlay -- avoids event bubbling issues)
- Arrow navigation between references (click + keyboard) with position indicator
- Video references (`.mp4`, `.webm`, `.mov`) render as `<video>` thumbnails (muted, preload=metadata) and `<video controls autoPlay>` in Dialog
- Comprehensive input extraction in `gallery.ts` collects ALL media URLs from `inputData` via `Set` deduplication:
  - Arrays: `referenceImageUrls`, `videoUrls`, `audioUrls`
  - Singles: `imageUrl`, `endFrameUrl`, `videoUrl`, `audioUrl`
  - Works for all job types automatically (image, video, audio, FFmpeg processing)

**Key Files:**
- `backend/src/routes/gallery.ts` -- Gallery API with comprehensive reference extraction
- `backend/src/routes/download.ts` -- Download proxy endpoint (R2 domain-locked)
- `frontend/src/app/gallery/page.tsx` -- Gallery page with lightbox, fullscreen, reference Dialog

### Database Additions
- `profiles.public_outputs` (boolean, default true) -- user preference for gallery visibility
- `jobs.is_public` (boolean, default true) -- per-job visibility flag set at processing time
- `idx_jobs_public_gallery` -- partial index on `(is_public, status, completed_at DESC)` WHERE `is_public = true AND status = 'completed'`
- RLS policy "Public gallery read" on `jobs` FOR SELECT USING `is_public = true AND status = 'completed'`

---

## AI Agent Node (v1.24, formerly AI Writer)

Generates multiple image prompts from a single concept via Claude Sonnet (2 credits). Spawns individual Generate Image nodes on canvas.
### Overview
AI Agent (display name changed from "AI Writer" in v1.24) generates multiple image prompts from a single concept, then spawns individual Generate Image nodes on the canvas. Uses Claude Sonnet via Anthropic API (2 credits per generation).

### Workflow
1. Connect a **reference image** + optionally a **Face** node
2. Select template (Photo Shoot, Product Catalog, Storyboard, Custom)
3. Run → generates N prompts separated by `===NEXT===`
4. "Create N Image Nodes" → spawns Generate Image nodes in 2-column grid with edges
5. "Generate All N Images" → runs all with concurrency limit of 3

### Key Files
- `backend/src/routes/ai-writer.ts` -- POST `/v1/ai-writer/generate` + `/generate-stream`
- `frontend/src/lib/ai-writer-templates.ts` -- 3 built-in templates + Custom
- `frontend/src/components/nodes/ai-writer-node.tsx` -- Node component with streaming + preview

### Architecture Notes
- Templates use `{outputCount}` placeholder replaced at runtime
- Predefined templates require connected reference image; Custom does not
- Created nodes tracked via `createdNodeIds` on AIWriterNodeData for cleanup on re-creation
- `handleCreateNodesFromWriter()` uses `getImageOutputHandle()` for correct source handle IDs
- Prompt truncation: 1500 chars at node creation, 2000 chars after wrapper expansion
- Calls backend directly (not via proxy) to avoid 30s timeout

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
| `subscriptions` | id, paddle_subscription_id, paddle_price_id, tier, status, current_period_start/end, canceled_at | Synced from Paddle |
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
  lib/paddle.ts           — Paddle.js singleton
  lib/edition.ts          — Edition helpers
  lib/pricing-data.ts     — Tier/model pricing constants
  types/nodes.ts          — Node data types

backend/src/
  server.ts               — Entry point
  app.ts                  — Fastify app + route registration
  worker.ts               — BullMQ job processor (video-worker)
  routes/                 — API routes (jobs, workflows, projects, admin-*, billing, gallery, download, user-settings, ai-writer)
  utils/watermark.ts      — Image + video watermark functions
  providers/              — AI provider abstraction (see Provider System above)
  billing/                — Credits, Paddle, cleanup (see Credit System above)
  middleware/             — credit-guard.ts, auth
  lib/config.ts           — Env config + edition helpers
  lib/admin-check.ts      — Shared cached admin check (30s TTL)
  lib/app-settings.ts     — Settings cache (60s TTL, stampede-safe)
```

---

## UI / Styling

**Accent Color**: `#ff0073` (pink) — primary buttons, active states, node animations, save button, sidebar active border.

**Dark Mode**: bg #121212, card #1E1E1E, border #2D2D2D, text #F8FAFC
**Light Mode**: bg #F8FAFC, card #FFFFFF, border #E2E8F0, text #1E293B

**Node Colors (MiniMap):** AI=purple, Input=blue, Parameter=indigo, Processing=amber, Output=green, Character=pink, Object=emerald, Location=cyan, Scene=violet, Sticky=yellow

---

## SSE Streaming Infrastructure

### Backend (`backend/src/lib/sse.ts`)

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

**Behavior:** Sets `text/event-stream` headers + manual CORS headers (bypasses `@fastify/cors`). Auto keepalive every 15s. All writes are no-ops after close.

### Frontend SSE Client (`frontend/src/lib/sse-client.ts`)

Async generator for SSE from POST requests (native `EventSource` only supports GET):

```typescript
import { streamRequest, type StreamEvent } from "@/lib/sse-client"

const controller = new AbortController()
for await (const event of streamRequest("/v1/ai-writer/generate-stream", {
  body: { systemPrompt, userInput, userId, model },
  signal: controller.signal,
})) {
  switch (event.type) {
    case "token": output += event.data; break
    case "done":  console.log("Complete:", event.data); break
    case "error": console.error(event.data.message); break
  }
}
controller.abort() // Cancel mid-stream
```

- Uses `fetch()` + `ReadableStream.getReader()` + `TextDecoder`
- Optional `baseUrl` to bypass Next.js proxy for real-time SSE
- Buffers partial chunks, skips SSE comments, supports `AbortSignal`

### Streaming API Wrapper (`frontend/src/lib/api.ts`)

```typescript
const { jobId, generatedText } = await generateAIWriterStream({
  systemPrompt, userInput, model, temperature, maxTokens, userId,
  onToken: (token) => { output += token; setText(output) },
  signal: abortController.signal,
})
```

Calls `POST /v1/ai-writer/generate-stream` via SSE (bypasses proxy). Returns `{ jobId, generatedText }` on done. On abort: returns gracefully with collected text.

### Streaming UX Pattern (AI Writer Node)
- **Streaming**: Tokens appear real-time with blinking cursor. Stop button visible. `accumulatedTextRef` flushes to Zustand via `requestAnimationFrame` (~60fps).
- `activeResultIndex = -1` at start so `generatedText` drives display (not stale results)
- DAG executor also uses `generateAIWriterStream()` -- same real-time tokens during workflow execution
- Both sync and streaming paths produce identical output format (`generatedText` + `generatedItems` + `generatedResults`)

### Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/ai-writer/generate` | POST | Legacy sync (full JSON) |
| `/v1/ai-writer/generate-stream` | POST | SSE streaming (event stream) |

Both share same Zod schema, credit guard, and job lifecycle.

### Adding Streaming to New Features
1. **Backend**: Import `createSSEStream` from `../lib/sse.js`. Send `metadata` → stream `token` events → `done`/`error` + `close()`.
2. **Frontend API**: Wrapper in `api.ts` calling `streamRequest()` with `onToken` callback + `AbortSignal`.
3. **Node component**: `accumulatedTextRef` + `requestAnimationFrame` flush to Zustand. `activeResultIndex: -1` at start. `isStreaming` state for cursor + stop button.

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
| Settings cache | 60s TTL, stampede-safe | Reduce DB queries, mutex prevents stampede |

---

## List Infrastructure (v1.25)

- **List Node**: Input node (0 credits). User enters items one per line. Dynamic config panel with add/edit/delete per row.
- **Execution**: `extractNodeOutputAsList()` returns `string[]`. `getListInputForNode()` detects list input from upstream. `executeNodeForList()` runs node N times sequentially with progress (`__listTotal`/`__listCompleted`/`__listResults`).
- **All node types**: `executeNode` accepts optional `overridePrompt` (no store mutation). Works for both "Execute workflow" and "Run This Node".
- **UI badges**: xN badge (cyan pill) showing iteration count. Running counter (fuchsia pill, animated) "2/3". Progress bar with gradient.

### Expand/Collapse Clones
- After list execution, `expandLoopResults()` creates visual clones (`node_7_iter_0`) with individual results. Originals hidden (`hidden: true`).
- Before any execution, `collapseExpandedClones()` removes clones, unhides originals, restores clean graph.
- Clone detection: `__expandedClone` flag AND `/_iter_\d+$/` ID pattern (backwards compat).

### Run Selected
- Multi-select → floating action bar with "Run selected (N)". Also in right-click context menu.
- `handleRunSelected()`: collapses clones, topological sort within selection only.
- Components: `selection-action-bar.tsx`, `node-context-menu.tsx`, store fields `runSelected`/`setRunSelected`

### Key Functions (workflow-editor.tsx)
| Function | Purpose |
|----------|---------|
| `collapseExpandedClones()` | Pre-execution: remove clones, unhide originals |
| `expandLoopResults()` | Post-execution: create clones from `__listResults` |
| `handleRunFromHere(nodeId)` | BFS forward, collapse first, execute downstream |
| `handleRunSelected()` | Execute selected nodes in topological order |
| `executeNodeForList()` | Run node N times for each list item |
| `getEffectivelySkippedIds()` | Compute skipped nodes + downstream propagation |

**Known issue:** `generatedResults` may accumulate across runs (cosmetic only).

---

## Loop Node (v1.26)

Table editor with dynamic columns/handles. Each column = output handle feeding values to downstream nodes.

- **Manual mode**: User defines columns + rows in table. Each column handle feeds column values as list.
- **Connected mode**: Upstream wires to `"in"` handle. Splits output by `\n`, overrides manual table.
- Reuses List execution path: `getListInputForNode` → `executeNodeForList`
- `edge.sourceHandle` resolves which column feeds which downstream node
- Dynamic handles require `useUpdateNodeInternals` (React Flow v12 doesn't auto-detect new `<Handle>` components)

**Key files:** `components/nodes/loop-node.tsx`, `types/nodes.ts` (`LoopColumn`, `LoopNodeData`), `config-panel.tsx` (`LoopConfig`), `workflow-editor.tsx`

---

## Skip Node (v1.20)

Right-click or multi-select to skip/unskip nodes. Visual: opacity-40 + dashed border + orange SKIP badge. Runtime-only flag (`data.skipped`), not persisted to DB.

**Effective Skip Propagation** (`getEffectivelySkippedIds`):
1. Directly skipped nodes (`data.skipped === true`)
2. Nodes whose ALL parents are effectively skipped (fixed-point cascade)
3. Nodes with at least one non-skipped parent still execute

**Key files:** `use-workflow-store.ts` (`toggleSkipNode`, `skipSelectedNodes`, `unskipSelectedNodes`), `node-context-menu.tsx`, `selection-action-bar.tsx`, `base-node.tsx`, `workflow-editor.tsx`

---

## Architecture Documentation (v1.21)

Auto-generated via `npx tsx scripts/generate-architecture.ts`. Produces:

| File | Git-tracked |
|------|-------------|
| `ARCHITECTURE.md` (full internal) | No |
| `ARCHITECTURE.public.md` (filtered, no admin/billing) | Yes |
| `architecture-graph.html` (D3.js import graph) | No |
| `architecture-graph.public.html` (filtered graph) | Yes |

Scans: project structure, API routes, DB tables, node types, AI providers, import graph, edition gating. Public version excludes admin/billing/paddle paths and tables.

---

## Backend Performance (v1.24.2)

### v1.24.1 — Initial optimizations (19 fixes)

**Shared utilities:**
- `lib/admin-check.ts` — `checkIsAdmin()` with 30s Map cache (replaces 4 duplicate copies)
- `lib/storage.ts` — exported `s3` client, added `batchDeleteFromR2()` (DeleteObjectsCommand, 1000 keys/batch)
- `routes/ai-writer.ts` — Anthropic client lazy singleton (`getAnthropicClient()`)

**Pagination & queries:**
- Gallery: cursor-based pagination (drops expensive `COUNT(*)`)
- Admin users: paginated with `limit`/`offset`/`search` params
- Admin credit summary: `Promise.all` for parallel profile + transaction queries
- Worker: single Supabase join query for job + profile (replaces 2 sequential queries)

**Streaming & memory:**
- Image proxy: `Readable.fromWeb().pipe(reply.raw)` — zero-copy streaming
- Upload: early MIME validation before `toBuffer()` — rejects bad types without buffering

**Caching:**
- App-settings: stampede-safe via `inflight` promise mutex
- Admin check: 30s TTL per-user cache
- Settings invalidation: `invalidateSettingsCache()` called on admin update

**Infrastructure:**
- Supabase client: disabled `autoRefreshToken` / `persistSession` for service-role
- Fastify: explicit `bodyLimit: 1MB` for JSON endpoints
- KIE verbose logging gated behind `NODE_ENV=development`
- Cleanup: batch R2 deletes replace serial `safeDeleteR2` loops
- Suno stems: parallel `Promise.all` uploads

### v1.24.2 — Quick wins (14 fixes)

**Correctness & revenue:**
- Removed global `server.requestTimeout` mutation in `ai-writer.ts` (was affecting ALL connections)
- Added `creditGuard` + `reserveCreditsForJob` to lip-sync route (was missing credit enforcement)
- Model pricing cache now invalidated after admin updates (`invalidateModelPricingCache()` in `admin-credits.ts`)

**Singleton clients:**
- 5 files replaced `new Replicate(...)` with import from `providers/replicate/client.ts` singleton
- Files: `script-generator.ts`, `translate.ts`, `generate-music.ts`, `text-to-audio.ts`, `transcribe.ts`

**I/O & memory:**
- New `uploadFileWithKeyToR2()` in `storage.ts` — streams local files to R2 instead of `readFile` + buffer
- Applied in: `download-video.ts`, `youtube-audio.ts`, `video-worker.ts`
- Removed unnecessary profile read-back in `reserveCredits` (saved 1 DB query per job)
- Removed unused gallery profiles query

**Polling backoff:**
- Exported `pollDelay()` from `kie/client.ts` (was private)
- Kling3 + all 4 Suno polling loops now use exponential backoff via `pollDelay()`

**Logging:**
- Kling3 + Suno verbose `console.log` calls gated behind `DEBUG = NODE_ENV === "development"` (~60 calls)
- `console.warn`/`console.error` left ungated (only fires on actual problems)

**Process reliability:**
- `unhandledRejection` + `uncaughtException` handlers on both `server.ts` and `worker.ts`
- Worker shutdown timeout (30s), `lockDuration: 900_000`, `stalledInterval: 300_000`
- R2 assets: immutable cache headers (`max-age=31536000, immutable`) on image-proxy + upload

**Key files changed:**
| File | What changed |
|------|-------------|
| `lib/storage.ts` | `batchDeleteFromR2()` (v1.24.1), `uploadFileWithKeyToR2()` (v1.24.2) |
| `lib/queue.ts` | BullMQ `defaultJobOptions`, removed `webhookQueue` |
| `providers/kie/client.ts` | `pollDelay()` exported, DEBUG logging |
| `providers/kie/kling3-client.ts` | Backoff polling, DEBUG logging |
| `providers/kie/suno-client.ts` | Backoff polling (4 loops), DEBUG logging (~34 calls) |
| `routes/lip-sync.ts` | Added `creditGuard` + `reserveCreditsForJob` |
| `routes/admin-credits.ts` | `invalidateModelPricingCache()` after model update |
| `server.ts` / `worker.ts` | Process error handlers, shutdown timeout |

### v1.24.3 — Medium-effort targeted refactors (5 fixes)

**Credit guard consolidation (saves 1-2 DB queries per AI request):**
- `creditGuard` now fetches profile ONCE with superset of columns, passes to both checks
- New `checkCreditsWithProfile()` and `checkStorageLimitWithProfile()` methods on CreditsService
- New exported types: `CreditProfile`, `StorageProfile` in `billing/credits.ts`
- Eliminated redundant tier query on storage-exceeded error (profile already fetched)
- Removed dead code: `checkLlmLimit()`, `trackLlmRequest()`, `LlmLimitResult` type

**FFmpeg zero-cost early return (saves 4-5 queries per FFmpeg request):**
- `creditGuard` returns immediately for `modelIdentifier === "ffmpeg"`
- `reserveCreditsForJob` also returns early for ffmpeg
- 8 FFmpeg routes (combine-videos, merge-video-audio, etc.) skip all credit DB queries

**Fetch timeouts on all 26 external calls (prevents hung processes):**
- Polling loops (KIE/Suno status checks): 10s timeout with TimeoutError → continue retry
- One-shot API calls (task creation, Replicate): 30s timeout
- File downloads (images, videos, streaming): 60-120s timeout
- Files: `kie/client.ts`, `kling3-client.ts`, `suno-client.ts`, `predictions.ts`, `image-proxy.ts`, `split-image.ts`, `storage.ts`, `ffmpeg-utils.ts`, `video-worker.ts`

**Batch cleanup service DB updates (reduces ~300 queries to ~10):**
- Asset updates: batch `.in("id", ids)` instead of per-asset updates
- Storage deltas: aggregated per-user before single `updateStorageUsage` call
- Job output cleanup: chunked `Promise.all` (10 concurrent) instead of sequential
- `expireSubscriptions`: batch profile fetch + batch update + batch subscription mark

**Gallery Cache-Control:**
- `GET /v1/gallery` returns `Cache-Control: public, max-age=30, stale-while-revalidate=60`

**Key files changed:**
| File | What changed |
|------|-------------|
| `middleware/credit-guard.ts` | Single profile query, FFmpeg early return |
| `billing/credits.ts` | `checkCreditsWithProfile`, `checkStorageLimitWithProfile`, dead code removal |
| `billing/cleanup-service.ts` | Batched all N+1 loops |
| `providers/kie/client.ts` | 4 fetch timeouts (30s create, 10s poll) |
| `providers/kie/kling3-client.ts` | 2 fetch timeouts |
| `providers/kie/suno-client.ts` | 10 fetch timeouts |
| `routes/predictions.ts` | 3 fetch timeouts (30s) |
| `routes/image-proxy.ts` | 1 fetch timeout (120s) |
| `routes/split-image.ts` | 1 fetch timeout (60s) |
| `routes/gallery.ts` | Cache-Control header |
| `lib/storage.ts` | 1 fetch timeout (120s) |
| `providers/video/ffmpeg-utils.ts` | 1 fetch timeout (120s) |
| `workers/video-worker.ts` | 1 fetch timeout (60s), removed dead trackLlmRequest call |

---

## Active TODOs
- [ ] Phase 7: Paddle production go-live (swap sandbox keys for production)
- [ ] Create monthly Paddle price IDs and add env vars (currently only annual prices exist)
- [ ] Phase 6 Templates (preset workflow templates)
- [ ] Landing page storage tier update
- [ ] Project Folders
- [ ] Version history per node
- [ ] Video generation with start+end frames (2 images → video) for supporting models
- [ ] /v1/available-models endpoint (filter by edition + API keys)
- [ ] TTS voice browser with categories, search, audio previews
- [ ] Translation: use AI (Gemini/Claude) not Google Translate
- [ ] Build from Prompt: MVP + Director Mode versions
- [ ] Scene Node + Shot Node as optional "Director Mode"

---

*Last updated: 2026-02-16*
*Version: 1.25.0*
