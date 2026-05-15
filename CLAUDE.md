# CLAUDE.md Maintenance Rule

**After every commit, update this file** to reflect new features, fixes, or architecture changes.
- Bump version (patch for fixes, minor for features)
- This root CLAUDE.md is tracked in git. Subdirectory CLAUDE.md files are gitignored.
- Full project spec is in `specs/FULL_SPEC.md` (reference only, don't load into context)

# Public Docs Maintenance Rule (CRITICAL)

**Whenever a change affects user-facing behavior, ALSO update `docs/`** in the same PR.

The `docs/` directory is published as the public reference (GitHub Pages). It must stay in sync with the editor reality. Treat it as a release artifact, not "we'll get to it."

**Triggers — you MUST update docs when:**

| Change | Docs to update |
|--------|----------------|
| New node added | Create `docs/nodes/<category>/<node-name>.md` AND add a row in `docs/nodes/README.md` |
| Node config field added/removed/renamed | The node's page in `docs/nodes/<category>/` |
| Node credit pricing changed (static or dynamic) | The node's page — include the formula and worked examples |
| New provider added to a node | Provider list in the node's page; if pricing changes, the credit table |
| New API route or breaking change to existing route | `docs/api-integration.md` and/or `docs/sdk-reference.md` |
| New OAuth scope or auth flow change | `docs/oauth-flow.md` |
| New deployment env var or build step | `docs/deployment.md` |
| New SDK feature or method | `docs/sdk-reference.md`, `docs/sdk-quickstart.md` |
| MCP tool added/changed | `docs/mcp/` |

**Rules:**
- Pricing math in docs MUST match the runtime formula. If you write a formula in code, write the same formula in the doc.
- Worked examples in docs MUST match the test cases in code (cross-check before committing).
- For dynamic-priced nodes, document both the formula AND the fallback behavior (what happens when upstream metadata is missing).
- If the change is rolled out under a flag, gate-check the doc — note the flag explicitly so users don't see undocumented behavior.

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

### `ee/` directory + dual-license boundary

Enterprise code lives under `backend/src/ee/` and `frontend/src/ee/` and is governed by the Nodaro Enterprise License (separate from the root SUL). The npm SDK packages under `packages/client/` and `packages/shared/` are Apache 2.0. See `LICENSE.md` at the repo root for the dual-license overview.

**Hard rules:**
1. **Core code may NOT statically import from `ee/`.** Enforced by `tools/check-ee-imports.mjs` in CI. Two permanent allowlist exceptions: `backend/src/app.ts` (route registration) and `backend/src/server.ts` (cleanup cron startup) — both gate the imports at registration time.
2. **Default placement:** put enterprise code in `backend/src/ee/` or `frontend/src/ee/`. The structure inside ee/ mirrors core (routes/, billing/, middleware/, lib/, services/, hooks/, layouts/, components/, app/).
3. **`*.ee.<ext>` filename suffix** is a deliberate exception for in-place enterprise variants of core files (e.g., `cost-tab.tsx` + `cost-tab.ee.tsx`). Per the Enterprise License, ANY file whose name contains the `.ee.` substring is enterprise — extension is unrestricted (`.ts`, `.tsx`, `.sql`, `.md`, `.json`, etc.). Use `ee/` directory by default; the suffix is reserved for tight coupling with a core sibling.
4. **Shim pattern for hot-path code:** `backend/src/middleware/credit-guard.ts` stays in core as a thin dispatcher; the heavy implementation lives in `backend/src/ee/lib/credit-guard-impl.ts` and is loaded via dynamic `import()` only when `hasCredits()` is true. Same pattern applies to `backend/src/workers/shared.ts` for credit operations.

**See also:** `tools/check-ee-imports.mjs` enforces the boundary in CI; the allowlist documents files with pre-existing coupling slated for refactor as Phase 3.5/4.5 work.

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
| 7 | `backend/src/ee/billing/credits.ts` | `STATIC_CREDIT_COSTS` (supports composite identifiers like `"gpt-image:high"`) |
| 8 | `frontend/src/lib/pricing-data.ts` | MODEL_REFERENCE |
| 8b | `packages/shared/src/prompt-wizard-categories.ts` | `PROVIDER_CAPABILITIES` entry for the node type |
| 9 | `supabase/migrations/NNN_*.sql` | **Write a migration with `INSERT INTO model_pricing ... ON CONFLICT DO NOTHING`** — must include the base identifier AND every composite (e.g. `:2K`, `:4K`, `:economy`, `:premium`). Without this row the model is invisible in `/admin/models` and `/admin/llm-models`. ⚠️ STATIC_CREDIT_COSTS is only a runtime fallback — the admin UI reads from the DB only. |
| 10 | `backend/src/ee/billing/stripe-config.ts` | If pricing tiers or credit allocations change |
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
| 3 | `backend/src/ee/billing/credits.ts` | `STATIC_CREDIT_COSTS` entry |
| 4 | `backend/src/ee/billing/credits.ts` | `CREDIT_COSTS` entry (same file — `credit-manager.ts` was merged into `credits.ts`) |
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

### Parameter Picker Node Registration (CRITICAL)

**A parameter picker is a node from a curated catalog with a tile-grid picker UI — Setting, Mood, Action FX, Loop Subject, Person, Lens, Pose, Animal, etc. (the families "Look", "Camera", "Subject / Object" in `parameter-picker-registry.tsx`). All of these emit a prompt-fragment that gets injected into a downstream node's prompt via FieldMappings — they NEVER make API calls and NEVER produce a job.**

There are FIVE registries a parameter picker must appear in. **Missing any one of them is a distinct, silent failure mode:**

1. **`PARAMETER_NODE_TYPES` (execution gate)** — if missing, the orchestrator treats the node as executable, creates a stale `pending` jobs row, then `buildPayload` throws `Unknown node type: <type>` and the entire workflow execution fails. Symptom: jobs row with `input_data: { type: "<node-type>" }` and no provider/started_at.
2. **`PARAMETER_PICKER_NODE_TYPES` (app-runtime UI gate)** — if missing, the published-app input card silently falls back to a generic text input bound to the wrong field. The picker UI never mounts. **Note:** input cards is what the user calls "app input visuals" — the node not appearing there means the user can't pick a value in published apps even though the catalog and picker component exist.
3. **`parameter-picker-registry.tsx` (full registry)** — if missing here but present in #2, `PickerInputCard` finds no meta and renders `null`. Card disappears entirely.
4. **`getParameterValue` (single-string fallback)** — if missing, `{NodeLabel}` ref resolution returns `undefined` and downstream prompts contain unresolved placeholders.
5. **`getParameterPromptHint` (FieldMappings injection)** — if missing, the prompt fragment never gets appended and the parameter has zero effect at execution.

**Before merging a parameter picker PR, manually verify all 5 registries contain the node type.** This has caused the same outage twice (action-fx, loop-subject).

**The full per-step checklist:**

| Step | File | What to Update |
|------|------|----------------|
| 20 | `frontend/src/lib/parameter-picker-types.ts` | Add the node type string to the `PARAMETER_PICKER_NODE_TYPES` set ⚠️ **Without this, `input-card.tsx` falls through to `ParameterCard` (text input) and the picker UI never mounts in apps** |
| 21 | `frontend/src/lib/parameter-picker-registry.tsx` | Add a `kind:"single"` (one valueField + catalog) or `kind:"multi"` (multiple fields + custom Picker) entry. Single: `nodeType`, `label`, `valueField`, `defaultValue`, `catalogId`, `entries: mapCat(CATALOG, "category")`, optional `groupOrder`/`groupLabels`/`renderIcon`. Multi: `fields`, `catalogEntries: flatCat(CATALOG)`, `Picker: erase(YourPickerComponent)`. |
| 22 | `packages/shared/src/<catalog>.ts` | If the catalog has categories, export `<NAME>_CATEGORY_ORDER` and `<NAME>_CATEGORY_LABELS` (mirror `action-fx.ts` / `loop-subject.ts`) so the registry's `groupOrder`/`groupLabels` can use them. Also export from `packages/shared/src/index.ts`. |
| 23 | `packages/shared/src/i18n/types.ts` | Add the `catalogId` literal to the `I18nCatalogId` union so `useLocalizedCatalog(catalogId)` typechecks. |
| 24 | `packages/shared/src/parameter-node-value.ts` | Add the node type string to the `PARAMETER_NODE_TYPES` set AND add a `case "<node-type>"` to `getParameterValue` returning `trim(data.<valueField>)`. ⚠️ **Forgetting this is the single most-broken way to add a parameter node** — the orchestrator treats it as executable, creates a `jobs` row with `input_data: { type: "<node-type>" }`, then `buildPayload` throws `Unknown node type` → workflow fails. Caused the same outage twice (action-fx in #1649-era + loop-subject in #2132). |
| 25 | `packages/shared/src/parameter-prompt-hint.ts` | Add a `case "<node-type>"` to `getParameterPromptHint` returning the prompt-fragment string. This is what FieldMappings appends to the consumer's prompt at execution time. If the catalog has multi-dim hints, build them via a helper (mirror `buildActionFxHints`); single-dim catalogs can call the catalog's `get<Name>PromptHint` directly. |

**The two UI registries (steps 20 and 21) MUST stay in sync.** The lightweight set in step 20 is what `input-card.tsx` (the published-app runtime) imports — it intentionally avoids the heavy registry to keep the bundle small. The full registry in step 21 is only loaded on demand. A node listed in step 20 but missing from step 21 will render `null` in apps; a node in step 21 but missing from step 20 won't be detected as a picker and will render as a generic text input bound to the wrong field.

**Steps 24 and 25 are the EXECUTION-side gate.** `PARAMETER_NODE_TYPES` is what `payload-builder.ts`, `input-resolver.ts`, and `resolve-field-mappings.ts` check to decide "this node is read from `data`, not executed as a job." A picker node missing from this set will: (a) get a stale `pending` jobs row created on every workflow run, (b) cause `buildPayload` to throw, (c) fail the entire workflow. The case in `getParameterValue` is unreachable until the type is in the set, so adding both together is mandatory.

**Reference example (single-dim picker):** `loop-subject` — see `parameter-picker-registry.tsx` line ~277, `parameter-picker-types.ts`, `parameter-node-value.ts` (set + `case "loop-subject"`), `parameter-prompt-hint.ts`.
**Reference example (multi-dim picker):** `person` — see `parameter-picker-registry.tsx` line ~424 + the `PersonPicker` component + `parameter-node-value.ts` `case "person"` (returns first non-empty dimension as the single-string fallback).

### Database Rules
- RLS on every table.
- **NEVER create RLS policies on `profiles` that query `profiles`** — infinite recursion. Use the `is_admin()` SECURITY DEFINER function instead.
- All credit operations must be atomic (RPC functions with `FOR UPDATE` locks).
***REDACTED-OSS-SCRUB***

---

## Architecture Rules (non-obvious)

| Area | Rule |
|------|------|
| `packages/shared/` | Pure logic shared between frontend + backend. Frontend imports the workspace package by name (`@nodaro/shared`, resolves to `packages/shared/dist/`). Backend uses RELATIVE imports — `tsc` doesn't rewrite path aliases. Backend `rootDir: ".."` so dist output is `dist/backend/src/`. Dockerfile must copy `packages/shared/dist/` into every build stage. **i18n sidecar exception:** `frontend/src/lib/i18n-bootstrap.ts` does `import.meta.glob("../../../packages/shared/src/i18n/*.*.ts")` so Vite can code-split each locale chunk. tsup bundles everything into one `dist/index.js`, so the per-file split is lost there — the Dockerfile's `frontend-build` stage must ALSO copy `packages/shared/src/i18n/` (not just dist) or the glob returns empty and every picker silently falls back to English. |
***REDACTED-OSS-SCRUB***
| Credit pricing | 1 credit = $0.02. Composite identifiers for variable pricing (`"gpt-image:high"`, `"flux:2K"`) — `VARIABLE_PRICING_MODELS` in `model-options.ts`, `buildCreditModelIdentifier()` in `helpers.ts` + route handlers. `STATIC_CREDIT_COSTS` is a runtime fallback only — admin UI reads from the `model_pricing` DB table. |
| LLM routing | All LLM calls go through `backend/src/lib/llm-client.ts` (`llmComplete()` / `llmStream()`). Model registry: `packages/shared/src/llm-models.ts`. Tiered pricing via `buildLlmCreditIdentifier()`. `resolveLlmCreditId()` reads `llmModel` from RAW body before Zod strips it. |
| Workflow orchestrator | BullMQ `"workflow-orchestration"` queue. Topological sort → level-by-level parallel execution. 3 execution categories: worker-queued (existing BullMQ queues), sync HTTP (internal fetch with service-role auth), inline (combine-text, split-text, composite). Per-node timeout 30min, per-workflow 60min. Stop modes: `"cancelled"` (immediate) vs `"stopping"` (finish current level). |
| Sub-workflow hierarchy | `parent_workflow_id` (migration 116) marks workflows that were auto-created from inside another. List endpoints (`GET /v1/projects/:id/workflows`, MCP `list_workflows`, `/v1/workflows/callable`) hide rows with `parent_workflow_id IS NOT NULL` so child workflows don't pollute project lists. Standalone workflows referenced by sub-workflow nodes (existing flow) keep `parent_workflow_id = NULL` and remain visible. Editable fullscreen sub-canvas via route-based navigation + breadcrumb (`useSubWorkflowStack`, `SubWorkflowBreadcrumb`, `useNavigateWithGuard` so dirty-state prompt fires). View modes via client-side registry at `frontend/src/components/nodes/sub-workflow-views/view-mode-registry.ts` (ships with default Ports view; storyboard/video/script land with the Story-to-Video Shot container in v2). Validation: every `sub-workflow-input` must pair with a `sub-workflow-output` sharing `routeId` and have ≥1 outputPort — enforced at workflow POST + PATCH via `validateSubWorkflowRoutes` in `@nodaro/shared`. New endpoint: `POST /v1/workflows/:parentId/sub-workflows` seeds a child with one input + one output node. |
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
| `@nodaro/shared` + `@nodaro/client` + `@nodaro/cli` | Public npm packages. `@nodaro/shared` exports types + model registries + prompt helpers (re-used by backend, frontend, client SDK). `@nodaro/client` is the typed REST client (createClient + 9 resources: workflows/projects/jobs/executions/nodes/apps/developerApps/oauth + me). `@nodaro/cli` (`packages/cli/`) is a thin commander-based wrapper around `@nodaro/client` — multi-profile auth at `~/.config/nodaro/config.json`, JSON output, `--watch` polling. Workspaces under `packages/`. Backend imports use `@nodaro/shared` (workspace symlink); frontend uses both via npm + `@nodaro/client` for the executions resource (incremental dogfood). Build via `tsup` (dual ESM+CJS). CLI also distributes standalone binaries via `bun build --compile` for darwin-{arm64,x64} + linux-{arm64,x64} + windows-x64; release workflow `cli-release.yml` triggers on `cli-v*` tags. Releases via changesets — see `.changeset/`. |
| Documentation | `docs/` is published via GitHub Pages (public). `specs/` is internal planning (NOT public). LICENSE is Apache 2.0. Public docs cover: deployment, architecture, OAuth flow, API integration, SDK quickstart + reference, contributing. The `.gitignore` rule for `ARCHITECTURE.md` is anchored to repo root (`/ARCHITECTURE.md`) so it does NOT silently match `docs/architecture.md` on case-insensitive filesystems. |
| MCP server | Per-request `McpServer` at `POST/GET /mcp` (`backend/src/lib/mcp/`). 4 tool families (verbs/jobs/workflows/components/apps/models/gallery) gated by scope; widgets returned alongside text from generation tools. **Workflow tools (`tools/workflows.ts`):** 9 tools — `list_workflows`/`get_workflow`/`get_workflow_json`/`export_workflow` (`workflows:read`), `create_workflow`/`delete_workflow`/`update_workflow_json`/`import_workflow` (`workflows:write`), `run_workflow` (`workflows:execute`). All except `export_workflow` are scoped to the user's auto-created "mcp" project via `ensureMcpProject(session)` (`tools/_mcp-project.ts`, caches `session.mcpProjectId`) — they validate `project_id` matches before any read/write/run. `export_workflow` can export ANY of the caller's workflows (template mode strips generated fields via `stripExportContent`; `with_assets=true` bundles characters/objects/locations — logic mirrors `routes/workflows.ts` since MCP has no user JWT). `import_workflow` parses + Zod-validates the bundle, re-creates bundled assets under the caller, remaps `*DbId` node fields, and always lands the workflow in the mcp project. `update_workflow_json` supports optimistic concurrency via `expected_updated_at`. **`buildMcpServer` is async** — `await registerDynamicTools()` inside. v2.0: per-user dynamic factory (`tools/dynamic.ts`) registers `app_<slug>` / `component_<slug>` MCP tools (cap 15+15=30) sorted by `coalesce(last_run_at, created_at) desc`. **Schema:** `published_apps` uses `creator_id` (NOT `owner_user_id`) and `is_active` (NOT `deleted_at`); migration 096 adds `last_run_at` + per-user recency index. Workflow widget (`widgets/workflow.ts`) is a vertical pill list with live `node:<id>:<status>` updates bridged from `executionEvents` → MCP `ui/message` via `progress-emitter.ts`. Widget runtime JS is `createElement`+`textContent` only — no raw HTML assignment; snapshot tests guard. v3.0: `/v1/oauth/app-info` returns `kind` (from migration 094); consent UI renders `<McpConsentNotice>` orange warning when `kind=dynamic_mcp` (self-claimed name via RFC 7591 DCR). Public docs at `docs/mcp/`; marketing landing at `/mcp`. |
| Image-to-video Loop Trim | `loopTrim?: { enabled, framesToTest, quality }` on `ImageToVideoData` runs a generic PSNR-based smart-loop-cut post-process after any i2v generation. Replaces the VEO-only `autoLoopTrim` (auto-migrated on workflow load via `use-workflow-store.ts:loadWorkflow`). Two quality modes: lossless (keyframe stream-copy, byte-perfect) / precise (libx264 re-encode, frame-precise). Pricing add-on: `ceil(duration/5) + ceil(framesToTest/24)` on top of the i2v base, wired via `computeCredits` hook on `creditGuard` (uses `getModelCreditBaseCost` to avoid double-markup). Failure mode: smart-loop-cut errors don't fail the whole job — the un-trimmed clip is kept and only the addon is refunded via `refundLoopTrimAddon` in `workers/shared.ts`. |
| KIE i2v image input | Every KIE image-to-video provider runs its start + end frames through `ensureImageForProvider` (`backend/src/providers/kie/video.ts`) before the API call: longest side capped at 2048px (no i2v model uses a larger input), and the Hailuo/MiniMax family (`modelConfig.model.startsWith("hailuo/")` → `minimax`, `hailuo-2.3`, `hailuo-2.3-pro`, `hailuo-standard`) is also re-encoded to JPEG (`forceJpeg`) because the MiniMax backend returns "internal error" on large RGBA PNGs despite the docs only listing a 10MB cap. VEO (`isVeoProvider`) and `runway-kie` are excepted — own endpoints, and they reference the raw URLs directly. `isVeoProvider`/`VEO_PROVIDERS` live in `packages/shared/src/model-constants.ts` alongside `isSeedance2Provider`. |
| Combine-videos resolution | `combineVideos` (`backend/src/providers/video/combine-videos.ts`) probes every downloaded clip up front via `pickTargetResolution` (most common (W,H), ties → largest area) and passes that target into `normalizeVideoForCombine`, which applies `scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1` to letterbox every clip to exactly the target. Without this, `xfade`/`acrossfade`/`concat` filters reject mismatched dimensions (`First input link main parameters (size A) do not match the corresponding second input link xfade parameters (size B)`). Even-rounding for yuv420p lives in `normalizeVideoForCombine` only. The dip-to-black/white path reuses the same target for its color clips. |

---

## App Run Archive (soft-delete)

`app_runs.deleted_at` makes `DELETE /v1/app/:slug/runs/:runId` a soft-delete. The run is hidden from the default list and recoverable from `/archived-runs` in the UI. API / SDK (`client.apps.deleteRun()`) / MCP (`delete_app_run` tool) all soft-delete by design — they cannot destroy data.

UI-only routes (deliberately not surfaced in SDK/MCP):
- `GET  /v1/me/archived-runs` — global archive list across all apps
- `POST /v1/app/:slug/runs/:runId/restore` — un-archive
- `DELETE /v1/app/:slug/runs/:runId/permanent` — real destroy (row + workflow_executions row; R2 reaped by cleanup-cron)

Permanent delete requires the run to be archived first (returns 400 `not_archived` otherwise).

---

*Last updated: 2026-05-15 (empty-prompt allowed when assembled prompt has content: frontend `execute-node.ts` no longer rejects empty user input before `buildImagePrompt` runs — `generate-image` / `image-to-image` / `modify-image` / `text-to-video` now check the FINAL assembled prompt (post mention resolution, identity directives, style, cinematography), so an empty user prompt with a wired Character (canonical fallback) or only `@kira:1:smile` still runs. Both `resolveVideoPromptMentions` functions (frontend + backend `payload-builder.ts`) updated to treat empty/undefined prompt as `""` so canonical fallback applies for character-only inputs. Backend Zod schemas unchanged — frontend sends the assembled prompt which is non-empty when assembly produced content. Negative case still rejects: empty user prompt + no character + no style + no cinematography → still throws "no prompt". character-mentions fix: frontend single-node runs of `image-to-image` and `modify-image` now build a full `connectedReferences` array (canonical + per-variant entries for every wired upstream Character node) before calling `buildImagePrompt`, so `@kira:N:variant` tokens in the prompt resolve to the variant URL via Phase 0 — same behavior the orchestrator already had via `expandWiredCharacterRefs` in `payload-builder.ts`. Bug: before this, the i2i/modify-image branches only passed flat URLs as `referenceImageUrls` to `buildImagePrompt`, skipping Phase 0 entirely, so `@kira:1:smile` survived as literal text in the prompt and ONLY the character's canonical sourceImageUrl attached (as the main `imageUrl`). Shared helper `buildConnectedRefsForI2I` in `execute-node.ts` keys character expansion by-source-node (NOT by chainRefs index) so the variants get added even when the character's URL is consumed as the main image. Reference: `expandCharacterNodeIntoRefs` mirrors the backend `expandWiredCharacterRefs` (parity for single-node ↔ orchestrator). Generate-image already had its inline expansion since the original PR #2407 and is unchanged. Frontend i2v/t2v/v2v single-node paths now apply `resolveVideoPromptMentions` (and the empty-prompt-allowed fix flows through). prompt-editor: TipTap `<PromptEditor>` (generate-image / image-to-image / modify-image) now mirrors `TagTextarea`'s hierarchical @-mention UX — one row per character at root, drill-in for variants, back row; character refs insert as PLAIN TEXT in the `@<slug>:N(:variant)?` format with N computed by scanning existing tokens (max+1); non-character refs keep the atomic TipTap `imageRef` node so `{image:N:label}` round-trips. Drill-in clears the typed filter via a parent-supplied `clearFilter` callback that `deleteRange`s chars after `@`; Backspace in drill-in with empty filter pops back to root. Closes the regression where image-to-video (TagTextarea) inserted `@kira:1:smile` but generate-image still inserted `@image:N:label`. Files: `frontend/src/components/editor/config-panels/prompt-editor/{index,suggestion-list}.tsx`. character-studio UX: AssetCard motion playback on hover (videos autoplay/pause on mouse-enter/leave with `loop`+`preload=metadata`; the prior decorative ▶ overlay was removed); hover overlay (Copy URL + Enlarge) now also renders for video cards; `MultiImageLightbox` extended with `kind: "image" | "video"` — videos render as controlled `<video>` with autoPlay+loop+muted+playsInline, `key={url}` forces a fresh element on arrow-nav; AssetCard gains `onInjectToCanvas` (+ icon) → creates `upload-image`/`upload-video` node 320px to the right of the source character node; AssetCard gains `onSetAsDefault`/`isDefault` (★ icon) → toggles per-canvas-node `defaultAssetUrl`+`defaultAssetName` on `CharacterNodeData` (frontend-only, NOT in `saveCharacter` payload); character node canvas thumbnail now uses `defaultAssetUrl` over `sourceImageUrl` when set, rendering motion defaults as `<video autoplay loop muted>`; studio state exposes `nodeId` so tabs avoid prop-drilling; shared helpers in `inject-helpers.ts`. Per-canvas-node defaults — two character nodes referencing the same DB row can show different defaults.)*
*Version: 2.13.4*
