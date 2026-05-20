# CLAUDE.md Maintenance Rule

**Update only when conventions, architecture, or registration steps change** — NOT on every commit. Change history belongs in `git log` and PR descriptions, not inline here.
- This root CLAUDE.md is tracked in git. Subdirectory CLAUDE.md files are gitignored.
- Full project spec is in `specs/FULL_SPEC.md` (reference only, don't load into context).
- If you find yourself writing a "Last updated: <date>" paragraph at the bottom, stop — that content goes in the PR description.

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
- `backend/src/providers/replicate/CLAUDE.md` — Replicate provider patterns, Flux 2 routing, Character LoRA training

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
| 2 | `frontend/src/components/editor/config-panels/*.tsx` | `<SelectItem>` options |
| 2b | `frontend/src/components/editor/config-panels/model-options.ts` | `IMAGE_*` or `VIDEO_RESOLUTION_OPTIONS` registries (single source of truth for dropdowns + fail-safe useEffect — see pitfall 1) |
| 3 | `backend/src/routes/<node-type>.ts` | **Zod validation schema** (see pitfall 2) |
| 4 | `backend/src/providers/kie/*.ts` or `replicate/*.ts` | Provider implementation |
| 5 | `backend/src/providers/kie/models.ts` | KIE model config (cost, params) |
| 6 | `backend/src/providers/kie/index.ts` or `replicate/index.ts` | `supportedModels` array |
| 7 | `backend/src/ee/billing/credits.ts` | `STATIC_CREDIT_COSTS` (supports composites like `"gpt-image:high"`) |
| 8 | `frontend/src/lib/pricing-data.ts` | `MODEL_REFERENCE` |
| 8b | `packages/shared/src/prompt-wizard-categories.ts` | `PROVIDER_CAPABILITIES` entry |
| 9 | `supabase/migrations/NNN_*.sql` | `INSERT INTO model_pricing ... ON CONFLICT DO NOTHING` — base id + every composite (see pitfall 3) |
| 10 | `backend/src/ee/billing/stripe-config.ts` | If pricing tiers/credit allocations change |
| 11 | `frontend/src/lib/pricing-data.ts` | `PRICING_TIERS` if tier features/prices change |
| 12 | `packages/shared/src/node-default-mappings.ts` | `QUALITY_MAP` + `deriveLinkedFields` — each entry MUST declare `field: "resolution" \| "quality"` (see pitfall 4) |
| 12b | Config panel for the node type | Provider-aware dropdowns MUST have `useEffect([currentProvider])` that snaps stale values to a valid option, or clears them when the new provider has no such lever (see pitfall 5). Reference: `image-configs.tsx::GenerateImageConfig`, `video-configs.tsx::ImageToVideoConfig`, `audio-configs.tsx::LipSyncConfig` |

**Common pitfalls (each has caused a recurring outage):**
1. **Step 2b registry drift** — a provider rendered in JSX but missing from `model-options.ts` won't have its stale state cleared by the fail-safe useEffect.
2. **Step 3 Zod enum forgotten** — has caused the same validation bug 3 times.
3. **Step 9 DB migration forgotten** — model invisible in `/admin/models` (the admin UI reads from DB only, not `STATIC_CREDIT_COSTS`). Audit with `audit-credits` skill.
4. **Step 12 `field` discriminator wrong** — silently writes a quality value into `data.resolution` (or vice versa), then the route's Zod enum rejects at generate-time.
5. **Step 12b fail-safe useEffect missing** — node configured for provider A carries A's resolution after switching to B; dropdown hides while data persists; B's Zod enum rejects A's value.

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

Most subsystem rules live in subdirectory CLAUDE.md files — Claude Code auto-loads each when working in that directory. This root keeps only cross-cutting rules.

| Area | Rule |
|------|------|
***REDACTED-OSS-SCRUB***
| Deployment | Railway + single multi-stage Dockerfile at repo root. `dev` → `next.nodaro.ai` (staging), `main` → `app.nodaro.ai` (prod). New `VITE_*` env vars MUST get both `ARG` and `ENV` lines in the Dockerfile — Vite inlines them at build time. |
| `@nodaro/shared` + `@nodaro/client` + `@nodaro/cli` | Public npm packages. `@nodaro/shared` exports types + model registries + prompt helpers (re-used by backend, frontend, client SDK). `@nodaro/client` is the typed REST client (createClient + 9 resources: workflows/projects/jobs/executions/nodes/apps/developerApps/oauth + me). `@nodaro/cli` (`packages/cli/`) is a thin commander-based wrapper around `@nodaro/client` — multi-profile auth at `~/.config/nodaro/config.json`, JSON output, `--watch` polling. Workspaces under `packages/`. Backend imports use `@nodaro/shared` (workspace symlink); frontend uses both via npm + `@nodaro/client` for the executions resource (incremental dogfood). Build via `tsup` (dual ESM+CJS). CLI also distributes standalone binaries via `bun build --compile` for darwin-{arm64,x64} + linux-{arm64,x64} + windows-x64; release workflow `cli-release.yml` triggers on `cli-v*` tags. Releases via changesets — see `.changeset/`. |
| Documentation | `docs/` is published via GitHub Pages (public). `specs/` is internal planning (NOT public). LICENSE is Apache 2.0. Public docs cover: deployment, architecture, OAuth flow, API integration, SDK quickstart + reference, contributing. The `.gitignore` rule for `ARCHITECTURE.md` is anchored to repo root (`/ARCHITECTURE.md`) so it does NOT silently match `docs/architecture.md` on case-insensitive filesystems. |

**Subsystem rules** — see the relevant subdirectory CLAUDE.md (auto-loaded by Claude Code when you work in that directory):
- **`backend/CLAUDE.md`** — Credit pricing, LLM routing, Workflow orchestrator, Sub-workflow hierarchy, Tier parallelism, Single-node execution history, Watermark, Webhook triggers, TTS v3 vs v2, Auth + OAuth, Dynamic CORS, Developer apps, MCP server, Image-to-video Loop Trim, Combine-videos resolution, Default project per user, Internal-only models, Suno Voice Persona, Character LoRA training, App Run Archive (soft-delete), `packages/shared/` build invariants.
- **`frontend/CLAUDE.md`** — Image generation params (per-provider param routing), UI styling, API proxy, SSE client.
- **`backend/src/providers/kie/CLAUDE.md`** — KIE i2v image input (size cap + Hailuo JPEG re-encode), KIE API patterns, model key → doc map.
- **`backend/src/providers/replicate/CLAUDE.md`** — Replicate provider patterns, Character LoRA training (Cloud-only, webhook + CAS slot claim), Flux 2 Klein/Pro/Max routing with pinned `safety_tolerance: 5`.

---

*Last updated: 2026-05-19 (Story-to-Video Phase 1C.3: Continuity Methods 3/8/10 + table-driven Stage 7 + 9 /simplify follow-ups. Method 3 (video_continuation): VEO Extend wired natively (uses kieTaskId); Seedance 2/Seedance 2 Fast wired via workaround — prior clip as reference_video_urls + prior last_frame as first_frame_url + "continue seamlessly" prompt amendment, NOT frame-perfect. Method 8 (frame_interpolation): RIFE + Topaz Apollo provider routes stubbed (provider_not_available:<model> until wired); Stage 6 generates one sub-keyframe per interpolation_keyframes[N].prompt; auto-mode falls back to first_frame. Method 10 (camera_path): SV3D stubbed (no public provider); text-prompt fallback via cameraPathToPromptAmendment() works universally for any i2v model (orbit/dolly/crane/arc/reveal). New ShotSpec fields: extends_shot_id, interpolation_keyframes, camera_path_directive. VIDEO_MODEL_CAPS gains rife/topaz-apollo/stable-video-3d entries. Stage 7 handler shrunk 48% (715→371 lines) via STAGE_7_SUB_STEPS table-driven registry — Methods 3/8/10 each adds 1 sub-step entry. Shot List Critic validates eligibility (prior-shot extension support / ≥2 keyframes / valid path_kind) BEFORE Stage 7 runs. Scene Director auto-pick heuristic adds 3 new rows + provider-availability caveat. Frontend scene-configs.tsx per-shot editor surfaces 3 new conditional sections. 9 /simplify follow-ups landed: probeAudioDuration extracted (_probe-audio.ts), freecut timeline reduction extracted (_freecut-timeline.ts), dead delivery_style + _pipeline_role dropped, animate-audio-edit.ts uses Partial<PipelineConfig>, allocateReferenceSlots hoists scene-level entity resolution (80%+ DB reduction — 80→10 queries for 5×8 pipeline), shot-list config race-window documented, aubio maxBuffer 5MB cap, narration plan load gated on narration_enabled. Backend tests: 6618→6639 (+21).)*
*Also 2026-05-19: two parameter-picker nodes shipped — **Transition** (76-entry catalog, graph-aware `startState`/`endState` handles, multi-pick + position/duration/intensity timing fields) and **Character FX** (57-entry catalog, single `target` ref handle with `\bthe subject\b` global substitution, multi-pick + same timing fields). Both lift the action-fx multi-pick picker pattern and ship 11 empty i18n stubs each. Public docs at `docs/nodes/parameters/{transition,character-fx}.md`.*
*Last updated: 2026-05-20 (Story-to-Video Phase 1D.1: Match Cut Critic auto-invocation. `runValidateMatchCut` (Phase 1C.1 on-demand helper) now also runs automatically during Stage 6 (scene_images) for every shot with shot_intent.is_match_cut=true AND a next shot in the same scene. New helper `matchCutOrchestrator` at backend/src/ee/pipelines/match-cut-orchestrator.ts (per-scene, concurrency=3 via settledWithLimit) finds eligible pairs, runs the critic, and returns per-shot verdicts + the list of shot_ids whose match_strength==='break'. Stage 6 aggregates across scenes and persists to `pipeline_stages.output.match_cut_verdicts: Record<shotId, MatchCutVerdict>` + `output.match_cut_break_pending: shotId[]`. When pendingBreaks is non-empty, Stage 6 sets `current_sub_gate='match_cut_break_pending'` + status='awaiting_approval' and refuses to advance. New scene-helper route `POST /v1/pipelines/:id/entities/:sceneId/helpers/accept_match_cut_break` (creditCost: 0) flips `shot.accepted_match_cut_break=true`, removes the shotId from pending, and when the list goes empty clears the sub-gate + flips status='running' + enqueues a pipeline-run job so Stage 6's `advanceToAwaitingApproval` completes the transition. New ShotSpec field `accepted_match_cut_break?: boolean` (survives stage re-runs). New shared schema `MatchCutVerdictSchema` (shot_pair tuple, match_strength enum, suggested_adjustments, checked_at). New SubGateName 'match_cut_break_pending' on the shared SubGateNameSchema (and StageAwaitingSubGateEventSchema.stageName broadened from literal('animate_audio_edit') to enum(['animate_audio_edit','scene_images'])). Frontend scene-configs.tsx per-shot match-cut surface: side-by-side keyframe thumbs + colored match_strength chip + Accept break button (when match_strength==='break' && !accepted_match_cut_break) + 'Break accepted' pill when accepted. config-panel.tsx wires Stage 6 output via pipelinesApi.getStage(pipelineId, 'scene_images') with 5s polling while panel open. Tests: backend +9 (B1=4, C1=5, D1=4-ish in own file), frontend +5. Total now 6746 backend / 3275 frontend.)*
*Last updated: 2026-05-20 (Story-to-Video Phase 1D.3: Branch-from-stage. New service `branchPipeline` at backend/src/ee/pipelines/branch-pipeline.ts clones upstream pipeline_stages (status='approved') + entities per spec §5.9 table — branching from scene_images clones character+object+location+scene entities; from shot_list clones character+object+location; from characters clones nothing upstream; etc. Branch stage itself starts as 'running'. Asset rows NOT duplicated (assets are content-addressed by R2 path; the new pipeline_entities reference the same asset_ids). New PipelineOrchestrationJobData.reason value 'branched' (queue.ts). New route `POST /v1/pipelines/:id/branch` (scope pipelines:execute) returns 201 + { pipelineId, clonedStages, clonedEntities }; error mapping pipeline_not_completed→400, pipeline_not_found→404, forbidden→403, invalid_stage→400. Frontend PipelinePanel adds a 'Re-run from stage' section when pipeline.status='completed' with one button per stage in PIPELINE_STAGE_NAMES; new branch lineage breadcrumb at the top when branched_from_pipeline_id is set ('← Branched from original pipeline (at {stage})'). New optional onNavigateToPipeline prop on PipelinePanel for parent-driven navigation between sibling pipelines. New SDK method `client.pipelines.branch(id, { fromStage })` on `@nodaro/client` (changeset minor bump). New MCP tool `branch_pipeline` scoped pipelines:execute, dynamic-import-loaded to respect the core→ee boundary. DB schema unchanged — branched_from_pipeline_id + branched_from_stage columns shipped in migration 121. Tests: backend +14 (8 service + 6 route + 7 MCP), frontend +6 (3 button + 3 breadcrumb), client +4. Total now 6800 backend / 3281 frontend.)*
*Also 2026-05-20 (admin reconcile visibility + KIE per-task audit): closes the last spec follow-ups from §9 + §10. **Admin /admin/jobs UI:** the `Jobs` table gains a `Recon` column showing `reconcile_attempts` (red badge with `!` when `reconcile_last_error="exhausted"`, secondary badge otherwise, `-` when 0); the row-detail dialog adds a `Reconciliation` section with `provider_kind`, `provider_task_id`, attempts, `provider_call_started_at`, and `reconcile_last_error`. Backed by 5 new fields on the `AdminJob` interface in `use-admin-queries.ts` + matching SELECT additions. **`/admin/credit-audit` page** gains a third mode `Per-task Diff` that calls `POST /v1/admin/credit-audit/sync` with `mode: "per-task"`. Backend handler batches `SELECT jobs WHERE provider_task_id IN (...)` against KIE log records (~500-row batches), per task computes `expected = ceil(kieCredits/4 × markup)` vs the job's actual `credits`, tags each row OK/UNMATCHED/UNDERCHARGED/OVERCHARGED (±1 credit tolerance). New `PerTaskTable` component sorts mismatches first. Surfaces outlier tasks the model-level aggregate `actual` mode averages away. Tests: 6844 still pass; backend per-task handler exercised manually until next staging soak.)*
*Also 2026-05-20 (input-fingerprint dedup, anti-double-click): adds dedup at the `creditGuard` middleware layer (all editions). On each job-creating POST, computes `sha256(req.url + stable-stringified body)`; if the same user has a `jobs` row with the same fingerprint within 10s, the POST short-circuits with `200 { jobId, deduped: true }` + `X-Dedup-Hit: 1` header instead of creating a new job + reserving credits. **Architecture:** new `backend/src/lib/dedup-fingerprint.ts` exports `computeFingerprint()` (recursive stable-stringify + SHA-256) + `findRecentMatchingJob()` (uses partial index `jobs_dedup_idx` from migration 144); `middleware/credit-guard.ts` outer shim runs the dedup check BEFORE delegating to the cloud `credit-guard-impl`; `reserveCreditsForJob` backfills `jobs.input_fingerprint` so we don't need to touch each of the 73 job-creating routes' INSERTs. **Opt-out:** `creditGuard(resolver, { dedup: false })` for routes whose response shape isn't `{ jobId, ... }` — currently only `routes/voice-clones.ts` (both POST handlers) since they return a `voice_clones` row directly. **Best-effort:** `findRecentMatchingJob` swallows DB errors and returns null so dedup never breaks a generation. **Race window:** ~5-50ms between INSERT and `reserveCreditsForJob`-backfill — bounded by single-DB-roundtrip latency, well below human double-click cadence (200-1000ms). Tests: +23 (14 fingerprint + 9 creditGuard dedup). Total 6844 pass.)*
*Also 2026-05-20 (Phase 5.2): migrated standalone `sweepStaleVoiceJobs` cron (every hour at :45) into the unified reconcile system. Two new provider kinds: `kie-suno-voice-create` (120 min stale threshold, sync — refunds the 20cr reservation if user abandons the modal) and `kie-suno-voice-validate` (24h × 60 min threshold, sync — no credits, just GC). Both routes in `routes/suno.ts` now write `provider_kind` + `provider_call_started_at` on the relevant jobs row: validate sets it in the post-success INSERT; generate calls `markProviderCallStart(jobId, "kie-suno-voice-create")` immediately before `sunoVoiceGenerate`. `sweepStaleVoiceJobs` function deleted from `ee/billing/cleanup-service.ts` and its standalone cron entry removed from `ee/billing/cleanup-cron.ts` (down to 8 schedules from 9). Tests: 6818 still pass; `types.test.ts` updated for the 2 new kinds. Detection cadence improves from 60min → 5min as a bonus.)*
*Also 2026-05-20 (Phase 5.1 follow-up): three ElevenLabs sync ops now instrument `provider_kind="elevenlabs-sync"` via `markProviderCallStart` — `routes/voice-clones.ts` (both POST handlers, before the `/v1/voices/add` fetch), `workers/handlers/audio-ai.ts:handleVoiceDesign`, `workers/handlers/audio-ai.ts:handleForcedAlignment`. Without these, stuck rows for these ops were invisible to sync-sweep (the cron filters `not("provider_call_started_at","is",null)`). Also: cron `else` branch for unknown `provider_kind` values now falls through to `sweepStaleSyncJob` per spec §5.5 catch-all (was `skippedAsync++`, no recovery). `skippedAsync` field dropped from `ReconcileResult` + log line. Tests: backend +3 (1 cron catch-all + 2 audio-ai handler instrumentation). Total 6818 pass.)*
*Last updated: 2026-05-20 (External-call reconciliation Phase 5: attempt-cap force-fail + anomaly logging. New shared helper `bumpAttemptsOrExhaust` at `backend/src/lib/reconcile/bump-attempts.ts` replaces the three near-identical local `bumpAttempts` copies in `kie.ts` / `replicate.ts` / `elevenlabs.ts` (Phase 3). When `jobs.reconcile_attempts + 1 >= MAX_ATTEMPTS` (=18, 90-min budget), the helper force-fails the job — CAS-guarded on `.in("status", ["pending","processing"])` against a user-cancel race — refunds reserved credits via `refundReservedCreditsForJob`, and inserts a `reconcile_exhausted` row into `credit_anomalies` so admins see the loss. Migration 143 adds `'reconcile_exhausted'` to the `credit_anomalies.anomaly_type` CHECK constraint (joining `overcharge`/`undercharge`/`unknown_model`/`zero_cost`). New `MAX_ATTEMPTS = 18` exported from `lib/reconcile/types.ts`. Cron log line in `ee/billing/cleanup-cron.ts:173` now includes `recovered=N` (was missing despite being tracked in `ReconcileResult`). Tests: backend +10 (`bump-attempts.test.ts` covers sub-cap, at-cap, CAS race, missing usage_log, null attempts, Error/string error inputs, 500-char truncation). Closes the last gap in the original reconciliation spec — stuck rows can no longer accumulate indefinitely.)*
*Also 2026-05-20 (combine-videos transitions picker): combine-videos config now exposes ~50 FFmpeg `xfade` transitions through a tabbed picker (Common + 9 groups: Fades, Wipes, Slides, Smooth, Shapes, Slices, Reveals, Covers, Effects) mirroring person-picker's ethnicity-tab layout. Each tile shows a looping pure-CSS mini-preview + tooltip description. Catalog of record at `packages/shared/src/combine-transitions.ts` (single source of truth for Zod, worker resolver, MCP combine_videos tool, frontend picker). **Two silent behavior changes:** `dip-to-black`/`dip-to-white` now route through FFmpeg's built-in `fadeblack`/`fadewhite` xfade (was: interleave a generated solid-color clip between every input pair — one fewer ffmpeg pass per dip); `dissolve` now produces the real `dissolve` xfade pixel-noise pattern (was: silently aliased to `fade`). The 5 legacy ids (`cut`/`fade`/`dissolve`/`dip-to-black`/`dip-to-white`) stay valid so saved workflows keep working. Tests: shared +8, backend +0 (existing 26 updated for new xfade names + new-id spot-check). Frontend has no picker tests yet — flagged follow-up.)*
*Also 2026-05-20 (combine-videos follow-ups bundle): four small wins on top of the picker. (1) **Audio crossfade curves** — combine-videos now exposes 5 `acrossfade=curve=...` presets (`linear`→`tri`, `equal-power`→`qsin`, `smooth`→`hsin`, `logarithmic`→`log`, `exponential`→`exp`) via an advanced disclosure under `audioMode: "crossfade"`. New shared catalog at `packages/shared/src/audio-crossfade-curves.ts`; `buildAudioFilter` now emits `acrossfade=d=...:c1=<curve>:c2=<curve>`; default `linear` preserves existing behavior bit-for-bit. New `audioCrossfadeCurve` field on `CombineVideosData` + route Zod + MCP tool + SDK client + executor. (2) **Catalog snapshot test** — `combine-transitions.test.ts` now inline-snapshots the sorted id list so a silent rename/drop is caught at CI time. (3) **Picker value-sync test** — 5-test Vitest + `@testing-library/react` covering the `useEffect` that re-syncs `activeTab` when `value` changes externally (workflow load / undo / redo). (4) **Pipeline-final-merge comment** — added a 5-line clarifying note at `pipeline-final-merge.ts:540` explaining why story-level `dissolve` stays on the `fade` xfade (LLM-emitted soft blend, NOT pixel-noise dissolve). Tests: shared +5, frontend +5. Also: regen'd `backend/skills/nodes/combine-videos.md` after the previous PR's `transition: string` type change (gen-skills:check CI drift).)*
*Also 2026-05-20 (Story-to-Video Phase 1D.2a — Auto Mode + plan-level critics): `pipelines.mode='auto'` wired end-to-end. Stage 1 parallel critic block extended with new `runLocationsCoverageCritic` (Sonnet, mirrors cast-coverage) + synchronous `validateObjects` rule engine (`packages/shared/src/pipeline-validation.ts` — duplicate_key/empty_significance/unresolved_scene_object_ref/orphan_object). Failure mode unified: `script_critic_unresolvable` covers ALL Stage-1 critics; specific blocking critic surfaced via `pipeline_stages.critic_feedback.failure_detail` ('script'/'cast_coverage'/'locations_coverage'/'objects_validation'). Bundled bug fix: old script.ts:144 failure guard had `scriptVerdict.verdict === "fail" &&` prefix that silently let blocking-only cast/locations/objects verdicts pass to awaiting_approval — fixed. Stages 2–8 gain auto-mode resting states: Stages 2/3/4/5/6 bulk-approve entities + canvas nodes via shared `bulkApproveStageEntities` helper in `stage-utils.ts` (extracts 7-duplicated-sites pattern; -62 lines). Stages 7/8 already auto-aware via existing sub-step branches. Match-cut sub-gate (1D.1) preserved unconditionally — auto-mode does NOT bypass the critic. New `LocationsCoverageCriticVerdictSchema` extends `CriticIssueSchema` (issue_type discriminant; scene_index uses .nullish() to match sibling-critic LLM convention). `RunShowrunnerArgs.criticFeedback` now typed as 4-verdict envelope. New `PATCH /v1/pipelines/:id { mode: 'manual' }` route (scope `pipelines:execute`, allowed transitions: mode IN ('auto','guided') AND status IN ('running','awaiting_approval'); failed pipelines recover via Branch 1D.3, NOT this route). `GET /v1/pipelines/:id` SELECT extended with `mode` + `failure_reason`. Queue enum `PipelineOrchestrationJobData.reason` gains `'mode_switch'`. Frontend: PipelinePanel renders Auto/Guided badge + threads `mode` to StageRow + EntityGrid + EntityCard + mounts ModeSwitchButton (visible when mode IN ('auto','guided') AND status IN ('running','awaiting_approval')); StageRow hides Approve/Reject in auto + renders "Auto: critic gating…" hint; critic-failure surface renders for *_unresolvable failures; new `pipelinesApi.patchMode`. Public docs at `docs/nodes/generative/generative-pipeline.md` add "Modes (manual / auto / guided)" section. Tests: backend +101 (script.test.ts +6, characters/objects/locations/shot-list/scene-images-auto-mode +9 collectively, pipelines-patch-mode +9, locations-coverage-critic +2, pipeline-validation +6, auto-mode-end-to-end +3, plus engine + route extensions), frontend +15 (mode-switch-button +7, pipeline-panel mode-related +8). Totals: 6836 backend / 3296 frontend. PR 2 (1D.2b Guided chat) is a separate plan at `docs/superpowers/plans/2026-05-20-story-to-video-phase-1d2b.md`.)*
*Version: 2.30.0 — Last updated 2026-05-20.*
