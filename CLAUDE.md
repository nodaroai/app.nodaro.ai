# CLAUDE.md Maintenance Rule

**After every commit, update this file** to reflect new features, fixes, or architecture changes.
- Bump version (patch for fixes, minor for features)
- This root CLAUDE.md is tracked in git. Subdirectory CLAUDE.md files are gitignored.
- Full project spec is in `docs/FULL_SPEC.md` (reference only, don't load into context)

**See also:**
- `frontend/CLAUDE.md` — Frontend patterns (API proxy, SSE client, UI styling)
- `backend/CLAUDE.md` — Backend patterns (providers, credits, billing, worker)
- `backend/src/providers/kie/CLAUDE.md` — KIE.ai API docs, model key → doc map, param gotchas

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
**Frontend helpers** (`frontend/src/lib/edition.ts`): Same names, reads `VITE_EDITION`

**Rules:**
- Never use raw `config.EDITION === "..."` -- use helper functions
- Credit-related code must be gated behind `hasCredits()`
- Admin-related code must be gated behind `hasAdmin()`

### Coding Standards
- **Backend**: Fastify plugin pattern (NOT Express Router)
- **Frontend**: Vite + React Router 7 + shadcn/ui + Tailwind
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
| Frontend | Vite 6, React Router 7, React Flow, shadcn/ui, Tailwind |
| Backend | Fastify (Node.js/TypeScript), BullMQ (Redis) |
| Database | Supabase (PostgreSQL + Auth + Realtime) |
| Storage | Cloudflare R2 (S3-compatible) |
| Auth | Supabase Auth (Google OAuth) + JWT middleware (`middleware/auth.ts`, 5-min token cache) |
| Payments | Paddle (Merchant of Record) |

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
| `paddle_customers` | id, user_id, paddle_customer_id | Supabase <> Paddle mapping |
| `subscriptions` | id, paddle_subscription_id, paddle_price_id, tier, status, current_period_start/end, canceled_at | Synced from Paddle |
| `transactions` | id, paddle_transaction_id, type, amount_usd, credits_granted | Payment history |

---

## Project Structure

```
frontend/src/
  main.tsx                — Vite entry point
  router.tsx              — React Router config (createBrowserRouter)
  app/(auth)/             — Login, signup
  app/(dashboard)/        — Projects, workflows, billing, settings, library
  app/(admin)/            — Admin panel (cloud/business only)
  app/pricing/            — Pricing page (Paddle)
  app/gallery/            — Public community gallery
  routes/                 — Route wrapper components (workflow-editor-page, etc.)
  layouts/                — DashboardLayout, AdminLayout
  components/nodes/       — 30+ custom node components (including 3d-title-node)
  components/credits/     — CreditBalance, GenerateButton, etc.
  components/ui/          — shadcn/ui
  hooks/                  — useModelCredits, etc.
  lib/api.ts              — API client
  lib/paddle.ts           — Paddle.js singleton
  lib/edition.ts          — Edition helpers
  lib/pricing-data.ts     — Tier/model pricing constants
  types/nodes.ts          — Node data types

packages/remotion/        — Remotion compositions (slideshow, explainer, social-reel, documentary, scene-graph, after-effects, lottie-overlay, 3d-title)

backend/src/
  server.ts               — Entry point
  app.ts                  — Fastify app + route registration
  worker.ts               — BullMQ job processor (video-worker)
  render-worker.ts        — BullMQ render worker (Remotion, concurrency:1)
  routes/                 — API routes (jobs, workflows, projects, admin-*, billing, gallery, download, user-settings, ai-writer, after-effects-ai, lottie-overlay-ai, three-d-title-ai, render-video)
  prompts/                — AI system prompts (after-effects-system.ts, lottie-overlay-system.ts, three-d-title-system.ts)
  utils/watermark.ts      — Image + video watermark functions
  providers/              — AI provider abstraction (see Provider System)
  billing/                — Credits, Paddle, cleanup (see Credit System)
  middleware/             — credit-guard.ts, auth.ts (JWT verification + 5-min cache)
  lib/config.ts           — Env config + edition helpers
  lib/admin-check.ts      — Shared cached admin check (30s TTL)
  lib/app-settings.ts     — Settings cache (60s TTL, stampede-safe)
```

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
| Video composition | Remotion (`packages/remotion/`) | Scene graph renderer + after-effects renderer + lottie-overlay renderer + 3d-title renderer + legacy template converters via BullMQ worker |
| AI composition | Claude Sonnet → Scene Graph JSON | Natural language → track-based video composition (2 credits) |
| After Effects | Claude Sonnet → Effect Plan JSON | AI-generated post-processing (color grade, vignette, grain, noise, letterbox) applied to video (2 credits) |
| Lottie Overlay | Claude Sonnet → Overlay Plan JSON | AI-placed timed Lottie animations over video (2 credits), `@remotion/lottie` + `delayRender`/`continueRender` per overlay |
| 3D Title | Claude Sonnet → 3D Title Plan JSON | AI-generated animated 3D text scenes with camera, lighting, particles (3 credits), `@remotion/three` + Three.js + `@react-three/drei`, max 60s |
| Multi-plan rendering | `POST /v1/render-video/plan` | Generic `{ planType, plan }` envelope — any composer node can feed plans to Render Video |
| Media processing | FFmpeg in worker | 12 processing nodes (combine, merge, extract, captions, resize, trim, speed-ramp, loop, fade, mix-audio, adjust-volume, video-upscale), 0 credits |
| Translation | Gemini Flash via Replicate | Creative prompt translation |
| Settings cache | 60s TTL, stampede-safe | Reduce DB queries, mutex prevents stampede |

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

*Last updated: 2026-02-19*
*Version: 1.30.0*
