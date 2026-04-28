# CLAUDE.md Maintenance Rule

**After every commit, update this file** to reflect new features, fixes, or architecture changes.
- Bump version (patch for fixes, minor for features)
- This root CLAUDE.md is tracked in git. Subdirectory CLAUDE.md files are gitignored.
- Full project spec is in `specs/FULL_SPEC.md` (reference only, don't load into context)

**See also:**
- `frontend/CLAUDE.md` — Frontend patterns (API proxy, SSE client, UI styling)
- `backend/CLAUDE.md` — Backend patterns (providers, credits, billing, worker)
- `backend/src/providers/kie/CLAUDE.md` — KIE.ai API docs, model key → doc map, param gotchas

# Nodaro.ai — Claude Code Reference

## Development Conventions

### Git Workflow
- **Branching model**: `dev` (staging) → `main` (production)
  - Feature branches: branch from `dev`, PR back to `dev`
  - Railway auto-deploys `dev` to staging: `next.nodaro.ai`
  - After 1-2 days testing on staging, **always use a PR from `dev` to `main`** (never direct merge — Supabase requires PR events to apply migrations to production)
  - **Always regular merge** dev→main PRs (`gh pr merge --merge`, NOT `--squash`) — squash merge causes dev to diverge from main
  - Railway auto-deploys `main` to production: `app.nodaro.ai`
- **Branch naming**: `feat/`, `fix/`, `refactor/`, `docs/` prefixes
- **Commit style**: Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`)
- **Never commit to main or dev directly** -- always use feature branches + PR review
- **Never branch from main** -- always branch from `dev`
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
- Backend: Fastify plugin pattern (NOT Express Router). Zod schemas on every endpoint.
- Frontend state: React Query (server) + Zustand (UI) + React Flow (canvas).
- Never mutate objects/arrays — always copy.
- File size: 200–400 lines typical, 800 max.
- No `console.log` in production code.
- Stack: Vite 6 / React Router 7 / shadcn/ui / Tailwind frontend; Fastify + BullMQ (Redis) backend; Supabase Postgres; Cloudflare R2; Stripe.

### Provider Enum Sync (CRITICAL)

**EVERY time a provider list changes for ANY node type, update ALL of these:**

| Step | File | What to Update |
|------|------|----------------|
| 1 | `frontend/src/types/nodes.ts` | TypeScript type for node data |
| 2 | `frontend/src/components/editor/config-panels/*.tsx` | `<SelectItem>` options (split by node category) |
| 2b | `frontend/src/components/editor/config-panels/model-options.ts` | `IMAGE_ASPECT_RATIOS`, `IMAGE_RESOLUTION_OPTIONS`, `IMAGE_QUALITY_OPTIONS` if image model; `VIDEO_RESOLUTION_OPTIONS` if video model. ⚠️ These registries are the **single source of truth** consumed by both the dropdown rendering AND the fail-safe `useEffect` (step 12b). A provider rendered in JSX but missing from the registry won't have its stale state cleared. |
| 3 | `backend/src/routes/<node-type>.ts` | **Zod validation schema** ⚠️ MOST COMMONLY FORGOTTEN |
| 4 | `backend/src/providers/kie/*.ts` or `replicate/*.ts` | Provider implementation |
| 5 | `backend/src/providers/kie/models.ts` | KIE model config (cost, params) |
| 6 | `backend/src/providers/kie/index.ts` or `replicate/index.ts` | `supportedModels` array |
| 7 | `backend/src/billing/credits.ts` | `STATIC_CREDIT_COSTS` (supports composite identifiers like `"gpt-image:high"`) |
| 8 | `frontend/src/lib/pricing-data.ts` | MODEL_REFERENCE |
| 8b | `packages/shared/src/prompt-wizard-categories.ts` | `PROVIDER_CAPABILITIES` entry for the node type |
| 9 | `supabase/migrations/NNN_*.sql` | **Write a migration with `INSERT INTO model_pricing ... ON CONFLICT DO NOTHING`** — must include the base identifier AND every composite (e.g. `:2K`, `:4K`, `:economy`, `:premium`). Without this row the model is invisible in `/admin/models` and `/admin/llm-models`. ⚠️ STATIC_CREDIT_COSTS is only a runtime fallback — the admin UI reads from the DB only. |
| 10 | `backend/src/billing/stripe-config.ts` | If pricing tiers or credit allocations change |
| 11 | `frontend/src/lib/pricing-data.ts` | PRICING_TIERS if tier features/prices change |
| 12 | `packages/shared/src/node-default-mappings.ts` | `QUALITY_MAP` + `deriveLinkedFields` if the new provider has resolution/quality variants or a linked `model` field. Each `QUALITY_MAP` entry MUST declare `field: "resolution" \| "quality"` — providers with `resolution` levers (1K/2K/4K, 720p/1080p) and `quality` levers (medium/high, basic/high) write to DIFFERENT fields on node data, and the admin-defaults resolver writes to ONLY the declared field. Without a correct `field`, the resolver poisons the wrong field and the route's Zod enum rejects the request at generate-time. |
| 12b | Config panel for the node type | Provider-aware dropdowns MUST have a `useEffect([currentProvider])` that snaps `data.<field>` to the first valid option when invalid for the current provider, AND clears (`undefined`) when the current provider doesn't expose that lever at all. Without this, admin defaults or persisted workflow data carry stale values across providers and trip the route's Zod enum. Reference implementations: `image-configs.tsx::GenerateImageConfig`/`ModifyImageConfig`, `video-configs.tsx::ImageToVideoConfig`/`TextToVideoConfig`, `audio-configs.tsx::LipSyncConfig`. |

**Forgetting step 3 (Zod enum) has caused the same validation bug 3 times.**
**Forgetting step 9 (DB seed migration) means the model never appears in `/admin/models`** — `STATIC_CREDIT_COSTS` will still charge correctly, but admins cannot see or override the price. Audit gap with `audit-credits` skill before shipping.
**Forgetting step 12 `field` discriminator** silently writes a quality value (e.g. `"medium"`) into `data.resolution` for providers that don't use it, then the route's `resolution: z.enum(["1K","2K","4K"])` rejects the request — and vice versa.
**Forgetting step 12b fail-safe `useEffect`** means a node configured for provider A still carries A's resolution after the user switches to provider B; the dropdown hides while data persists, and B's Zod enum rejects A's value at generate-time.

### New Node Registration (CRITICAL)

**When adding a new node type, register it in ALL of these files:**

| Step | File | What to Update |
|------|------|----------------|
| 1 | `backend/src/routes/<node-type>.ts` | Route handler (Zod schema, credit guard, API call) |
| 2 | `backend/src/app.ts` | `app.register()` the route |
| 3 | `backend/src/billing/credits.ts` | `STATIC_CREDIT_COSTS` entry |
| 4 | `backend/src/billing/credit-manager.ts` | `CREDIT_COSTS` entry |
| 5 | `frontend/src/types/nodes.ts` | Data type + `SceneNodeData` union + `SceneNodeType` union + `NODE_DEFINITIONS` |
| 6 | `frontend/src/components/nodes/<node>-node.tsx` | Node component |
| 7 | `frontend/src/components/nodes/index.ts` | `nodeTypes` map |
| 8 | `frontend/src/components/editor/add-node-popup.tsx` | `NODE_OPTIONS` (popup/context menu) |
| 9 | `frontend/src/components/editor/node-toolbar.tsx` | Sidebar node list ⚠️ **SEPARATE from popup** |
| 10 | `frontend/src/components/editor/editor-toolbar.tsx` | Reset/clear `switch` case |
| 11 | `frontend/src/components/editor/config-panels/<cat>-configs.tsx` | Config component. If it exposes provider-aware dropdowns (resolution, quality, aspect ratio, voice, etc.), MUST include the fail-safe `useEffect([currentProvider])` from Provider Enum Sync step 12b — snap stale values to the first valid option, clear when the provider has no such lever. |
| 12 | `frontend/src/components/editor/config-panels/index.ts` | Export |
| 13 | `frontend/src/components/editor/config-panel.tsx` | Import, display name, button type set, render conditional |
| 14 | `frontend/src/lib/api.ts` | API client function |
| 15 | `frontend/src/components/editor/workflow-editor/types.ts` | `EXECUTABLE_NODE_TYPES` set ⚠️ **Without this, Run button fails** |
| 16 | `frontend/src/components/editor/workflow-editor/execute-node.ts` | DAG execution block |
| 17 | `frontend/src/components/editor/workflow-editor/execution-graph.ts` | `extractNodeOutput()` |
| 18 | `frontend/src/components/editor/workflow-editor/node-input-resolver.ts` | Input source mapping |
| 19 | `backend/src/lib/node-registry.ts` | `NODE_REGISTRY` entry — descriptor (label, category, outputType, optional creditCost/inputSchema/providers/capabilities) for `GET /v1/nodes` discovery API |

**Steps 8 and 9 are separate node lists — missing either means the node won't appear in that UI.**

***REDACTED-OSS-SCRUB***

### Database Rules
- RLS on every table.
- **NEVER create RLS policies on `profiles` that query `profiles`** — infinite recursion. Use the `is_admin()` SECURITY DEFINER function instead.
- All credit operations must be atomic (RPC functions with `FOR UPDATE` locks).
***REDACTED-OSS-SCRUB***

---

## Architecture Rules (non-obvious)

| Area | Rule |
|------|------|
| `packages/shared/` | Pure logic shared between frontend + backend. Frontend imports via Vite alias `@nodaro-shared/*`. Backend uses RELATIVE imports — `tsc` doesn't rewrite path aliases. Backend `rootDir: ".."` so dist output is `dist/backend/src/`. Dockerfile must copy `packages/shared/` into every build stage. |
***REDACTED-OSS-SCRUB***
| Credit pricing | 1 credit = $0.02. Composite identifiers for variable pricing (`"gpt-image:high"`, `"flux:2K"`) — `VARIABLE_PRICING_MODELS` in `model-options.ts`, `buildCreditModelIdentifier()` in `helpers.ts` + route handlers. `STATIC_CREDIT_COSTS` is a runtime fallback only — admin UI reads from the `model_pricing` DB table. |
| LLM routing | All LLM calls go through `backend/src/lib/llm-client.ts` (`llmComplete()` / `llmStream()`). Model registry: `packages/shared/src/llm-models.ts`. Tiered pricing via `buildLlmCreditIdentifier()`. `resolveLlmCreditId()` reads `llmModel` from RAW body before Zod strips it. |
| Workflow orchestrator | BullMQ `"workflow-orchestration"` queue. Topological sort → level-by-level parallel execution. 3 execution categories: worker-queued (existing BullMQ queues), sync HTTP (internal fetch with service-role auth), inline (combine-text, split-text, composite). Per-node timeout 30min, per-workflow 60min. Stop modes: `"cancelled"` (immediate) vs `"stopping"` (finish current level). |
| Tier parallelism | `TIER_PARALLELISM` in `stripe-config.ts` + `pricing-data.ts`: free=2, basic=4, standard=6, pro=10, business=12. Self-hosted editions read `MAX_CONCURRENT_NODES_PER_EXECUTION` env (default 12) as hard ceiling. |
| Single-node execution history | Frontend `setCurrentWorkflowId()` + `withWorkflowId()` inject workflowId into all job-creating API calls. Backend `extractWorkflowId(req.body)` reads it BEFORE Zod strips it. Standalone jobs (no `workflow_execution_id`) merged into execution lists as `triggerType: "single-node"`. |
| Watermark | Decision stored on `jobs.should_watermark` at credit reservation (NOT read from `profiles.tier` at processing time — prevents tier-upgrade bypass). |
| Webhook triggers | Public route `POST /v1/webhooks/:token` — 32-byte hex token IS auth. Rate-limited 10/min per token. |
| Image generation params | Per-provider param routing in `model-options.ts`: Nano Banana v1 uses `image_size` (no `resolution`); Nano Banana 2 + Pro use `aspect_ratio` + 1K/2K/4K resolution; `output_format` only sent to Nano Banana family; Flux Kontext/Max have their own aspect ratio set; `negative_prompt` sent natively for imagen4/ideogram/qwen, appended as "Avoid: …" for others. |
| TTS v3 vs v2 | ElevenLabs v3 supports `[audio tags]` and routes through direct ElevenLabs API (never KIE). v2 models go via KIE; worker `stripAudioTags()` removes `[…]` before sending. |
| Deployment | Railway + single multi-stage Dockerfile at repo root. `dev` → `next.nodaro.ai` (staging), `main` → `app.nodaro.ai` (prod). New `VITE_*` env vars MUST get both `ARG` and `ENV` lines in the Dockerfile — Vite inlines them at build time. |
| Auth + OAuth | 4 auth modes in `middleware/auth.ts`: Supabase JWT (`eyJ...`), OAuth dev-app token (`ndr_app_<64hex>`, 90-day TTL — sets `req.appAuthorization{appId, scopes}`), API token (`ndr_<64hex>`, legacy), internal RPC (`X-Internal-Orchestrator-Secret`). Resolution order: public route → internal-secret → `ndr_app_` → JWT → 401. Scope enforcement via `requireScope(req.appAuthorization?.scopes ?? [], scope)` — Supabase JWT path is no-op (user owns resources). 8 scopes in `lib/scopes.ts`. |
| Dynamic CORS | `lib/dynamic-origins.ts` — async DB-backed allowlist (60s cache, stampede-safe). Combines `getStaticAllowedOrigins()` (PUBLIC_URL + CORS_ORIGIN env) with `developer_apps.allowed_origins`. Cache invalidated on dev-app create/update/delete. Both `app.ts` CORS (async-promise form — NOT callback-form, double-fires) and `sse.ts createSSEStream` (now async) consume `isOriginAllowedDynamic()`. |
| Developer apps | `developer_apps` + `developer_app_authorizations` + `developer_app_tokens` tables. `POST /v1/developer-apps` (JWT) returns plaintext `clientSecret` ONCE. `POST /v1/oauth/authorize` (JWT) → one-shot code (10-min TTL) → `POST /v1/oauth/token` (client credentials) → `access_token`. RFC 7009 `revoke`. Public `GET /v1/oauth/app-info?client_id=` for consent screens. Service-role supabase imports allow-listed in `scripts/check-admin-client-import.mjs` (every query scoped by `owner_user_id` in-handler). |

---

*Last updated: 2026-04-28*
*Version: 1.94.0*
