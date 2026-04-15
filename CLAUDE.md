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
| 2 | `frontend/src/components/editor/config-panels/*.tsx` | `<SelectItem>` options (split by node category) |
| 2b | `frontend/src/components/editor/config-panels/model-options.ts` | `IMAGE_ASPECT_RATIOS`, `IMAGE_RESOLUTION_OPTIONS`, `IMAGE_QUALITY_OPTIONS` if image model |
| 3 | `backend/src/routes/<node-type>.ts` | **Zod validation schema** ⚠️ MOST COMMONLY FORGOTTEN |
| 4 | `backend/src/providers/kie/*.ts` or `replicate/*.ts` | Provider implementation |
| 5 | `backend/src/providers/kie/models.ts` | KIE model config (cost, params) |
| 6 | `backend/src/providers/kie/index.ts` or `replicate/index.ts` | `supportedModels` array |
| 7 | `backend/src/billing/credits.ts` | `STATIC_CREDIT_COSTS` (supports composite identifiers like `"gpt-image:high"`) |
| 8 | `frontend/src/lib/pricing-data.ts` | MODEL_REFERENCE |
| 8b | `packages/shared/src/prompt-wizard-categories.ts` | `PROVIDER_CAPABILITIES` entry for the node type |
| 9 | `model_pricing` DB table | Include actual provider cost |
| 10 | `backend/src/billing/stripe-config.ts` | If pricing tiers or credit allocations change |
| 11 | `frontend/src/lib/pricing-data.ts` | PRICING_TIERS if tier features/prices change |

**Forgetting step 3 (Zod enum) has caused the same validation bug 3 times.**

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
| 11 | `frontend/src/components/editor/config-panels/<cat>-configs.tsx` | Config component |
| 12 | `frontend/src/components/editor/config-panels/index.ts` | Export |
| 13 | `frontend/src/components/editor/config-panel.tsx` | Import, display name, button type set, render conditional |
| 14 | `frontend/src/lib/api.ts` | API client function |
| 15 | `frontend/src/components/editor/workflow-editor/types.ts` | `EXECUTABLE_NODE_TYPES` set ⚠️ **Without this, Run button fails** |
| 16 | `frontend/src/components/editor/workflow-editor/execute-node.ts` | DAG execution block |
| 17 | `frontend/src/components/editor/workflow-editor/execution-graph.ts` | `extractNodeOutput()` |
| 18 | `frontend/src/components/editor/workflow-editor/node-input-resolver.ts` | Input source mapping |

**Steps 8 and 9 are separate node lists — missing either means the node won't appear in that UI.**

***REDACTED-OSS-SCRUB***

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
| Auth | Supabase Auth (Google OAuth) + JWT middleware (`middleware/auth.ts`, 5-min SHA-256 token cache) |
| Payments | Stripe |

---

## Database Tables

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `profiles` | id, email, tier, subscription_credits, topup_credits, daily_spent_credits, storage_used_bytes, storage_limit_bytes, role, public_outputs, current_period_end, subscription_ended_at | Extends auth.users |
| `projects` | id, user_id, name, settings | |
| `workflows` | id, project_id, user_id, nodes (JSONB), edges (JSONB), source_prompt | React Flow data |
| `jobs` | id, workflow_id, user_id, status, progress, input_data, output_data, provider, provider_cost, is_public, should_watermark, workflow_execution_id | Execution records |
| `workflow_executions` | id, workflow_id, user_id, status, trigger_type, trigger_data, node_states (JSONB), total_nodes, completed_nodes, failed_nodes, total_credits_used | Backend execution tracking |
| `workflow_triggers` | id, workflow_id, user_id, type, config (JSONB), is_active, webhook_token | Webhook + schedule triggers |
| `assets` | id, user_id, job_id, type, r2_key, r2_url, size_bytes | Generated files |
| `characters` | id, project_id, name, description, reference_image_url, visual_traits (JSONB) | Per-project |
| `style_presets` | id, name, settings (JSONB), is_system, user_id | System + user-created |
| `usage_logs` | id, user_id, job_id, action, provider, credits_used, cost_usd | Billing audit |
| `model_pricing` | model_identifier (PK), credit_cost, is_enabled, tier_restriction | Credit costs |
| `app_settings` | key (unique), value (JSONB) | ai_provider, cost_markup_percent |
| `credit_transactions` | id, user_id, amount, credit_type, source, job_id | Audit log |
| `voice_clones` | id, user_id, name, elevenlabs_voice_id, sample_audio_url | Custom cloned voices |
| `stripe_customers` | id, user_id, stripe_customer_id | Supabase <> Stripe mapping |
| `subscriptions` | id, stripe_subscription_id, stripe_price_id, tier, status, current_period_start/end, canceled_at | Synced from Stripe |
| `transactions` | id, stripe_transaction_id, type, amount_usd, credits_granted | Payment history |
| `social_connections` | id, user_id, platform, platform_user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, scopes, metadata | OAuth tokens (AES-256-GCM encrypted), one per user+platform |
| `published_apps` | id, workflow_id, user_id, name, slug, version, nodes (JSONB), edges (JSONB), metadata, status | Versioned mini-app snapshots |
| `credit_anomalies` | id, user_id, job_id, model, expected_credits, actual_credits, status | Credit charge anomaly tracking |
| `kie_credit_snapshots` | id, balance, timestamp | KIE.ai account balance history (hourly) |
| `tutorials` | id, title, description, video_url, thumbnail_url, category, sort_order, is_enabled, created_at, updated_at | Admin-managed video tutorials |

---

## Project Structure

```
frontend/src/
  main.tsx                — Vite entry point
  router.tsx              — React Router config (createBrowserRouter)
  app/(auth)/             — Login, signup
  app/(dashboard)/        — Projects, workflows, billing, settings, library, integrations
  app/(admin)/            — Admin panel (cloud/business only): pricing, jobs, models, reports, settings, usage, users, credit-audit, kie-credits, alerts, apps, subscriptions
  app/pricing/            — Pricing page (Stripe Checkout)
  app/gallery/            — Public community gallery
  routes/                 — Route wrapper components (workflow-editor-page, etc.)
  layouts/                — DashboardLayout, AdminLayout
  components/nodes/       — 100+ custom node components (including 3d-title-node, motion-graphics-node, composite-node, extend-video-node, extract-frame-node, webhook-trigger-node, schedule-trigger-node, social-node, speech-to-video-node, sora-storyboard-node, sora-character-node, 13 suno-*-nodes, preview-node)
  components/editor/
    config-panel.tsx      — Thin dispatcher (~520 lines), delegates to config-panels/
    config-panels/        — 24 files: per-category node config components (image, video, audio, composition, entity, trigger, social, etc.) + tag-textarea.tsx (autocomplete for audio tags & Suno metatags) + prompt-helper-dialog.tsx (AI prompt enhancement) + aspect-ratio-selector.tsx (visual SVG tile grid) + llm-model-select.tsx (tiered model dropdown)
    remotion-player-preview.tsx — Generic @remotion/player wrapper (lazy-loaded)
    after-effects-player-preview.tsx — AE composition preview (shows when sourceVideo exists)
    motion-graphics-player-preview.tsx — MG composition preview (always available)
    workflow-editor/      — 13 files: DAG execution engine, node executors, polling, main component
    editor-error-boundary.tsx — React error boundary for Canvas + ConfigPanel
  components/presentation/ — App runner / presentation mode (presentation-view, node-picker-dialog, node-config-modal, node-section, sortable-card-wrapper)
  components/credits/     — CreditBalance, GenerateButton, etc.
  components/ui/          — shadcn/ui
  hooks/                  — useModelCredits, undo-flags (shared skip flag), use-undo-redo, use-workflow-store, etc.
  lib/api.ts              — API client (includes `setCurrentWorkflowId` + `withWorkflowId` for tagging single-node jobs)
  lib/stripe.ts           — Stripe.js singleton
  lib/edition.ts          — Edition helpers
  lib/audio-tags.ts       — Audio tags, SSML breaks, model-aware language lists (getLanguagesForModel, ALL_LANGUAGES)
  lib/suno-tags.ts        — Suno metatags for lyrics autocomplete ([Verse], [Chorus], genres, etc.)
  lib/pricing-data.ts     — Tier/model pricing constants
  lib/social-media-specs.ts — Platform labels, action specs, character limits
  components/integrations/ — Platform OAuth connect/disconnect cards
  types/nodes.ts          — Node data types

packages/shared/          — Shared pure logic between frontend & backend (model-constants, prompt-templates, ancestor-refs, credit-identifiers, prompt-builder, llm-models, types, presentation-utils)
packages/remotion/        — Remotion compositions (slideshow, explainer, social-reel, documentary, scene-graph, after-effects, lottie-overlay, 3d-title, motion-graphics, composite)

docs/                     — Public documentation (GitHub Pages); contains only nodes/ subfolder — NO pricing, KIE, or internal data
specs/                    — Internal specs (FULL_SPEC, BILLING, adding-a-new-node, new-kie-models-spec, etc.) — NOT public

backend/src/
  server.ts               — Entry point
  app.ts                  — Fastify app + route registration
  worker.ts               — BullMQ job processor (video-worker)
  render-worker.ts        — BullMQ render worker (Remotion, concurrency:1)
  orchestrator.ts         — BullMQ workflow orchestrator entry point (concurrency:2)
  routes/                 — 95 API route files (jobs, workflows, projects, admin-*, billing, stripe-webhook, gallery, download, user-settings, ai-writer, prompt-helper, after-effects-ai, lottie-overlay-ai, three-d-title-ai, motion-graphics-ai, audio-isolation, text-to-dialogue, render-video, voices, voice-clones, voice-changer, dubbing, voice-remix, voice-design, forced-alignment, extend-video, workflow-execution, webhook-triggers, social-auth, social-publish, speech-to-video, sora-storyboard, suno, published-apps, app-runner, app-analytics, admin-subscription-health, admin-credit-audit, admin-credit-anomalies, cancel-jobs)
  prompts/                — AI system prompts (after-effects-system.ts, lottie-overlay-system.ts, three-d-title-system.ts, motion-graphics-system.ts)
  utils/watermark.ts      — Image + video watermark functions
  providers/              — AI provider abstraction; KIE clients: `client.ts` (core + VEO), `kontext-client.ts` (Flux Kontext), `runway-client.ts` (Runway + Aleph), `luma-client.ts` (Luma Modify), `kling3-client.ts` (Kling 3.0), `suno-client.ts` (Suno ops), `credit-lookup.ts` (credit audit)
  billing/                — Credits, Stripe, cleanup (see Credit System)
  services/workflow-engine/ — Backend workflow orchestration (8 files: types, execution-graph, input-resolver, output-extractor, payload-builder, node-executor, inline-executor, sub-workflow-handler)
  services/social/        — Social media OAuth + publishing (encryption, oauth, platforms/)
  workers/orchestrator-worker.ts — Main orchestrator BullMQ worker
  middleware/             — credit-guard.ts, auth.ts (JWT verification + 5-min SHA-256 cache)
  lib/config.ts           — Env config + edition helpers
  lib/llm-client.ts       — Unified LLM client (KIE.ai chat-completions/messages/responses + Anthropic fallback)
  lib/request-helpers.ts  — `extractWorkflowId(body)` — reads optional workflowId from request body for single-node job tracking
  lib/admin-check.ts      — Shared cached admin check (30s TTL)
  lib/app-settings.ts     — Settings cache (60s TTL, stampede-safe)
  lib/orchestration-queue.ts — BullMQ queue for workflow orchestration
  lib/schedule-cron.ts    — Cron/interval scheduler for workflow triggers (60s check interval)
```

---

## Technical Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Backend language | TypeScript (Node.js) | Same as frontend, BullMQ native |
| Backend framework | Fastify | Fast, TypeScript-first, plugin system |
| Job queue | BullMQ | Best for Node.js, excellent dashboard |
| Execution model | Frontend DAG + Backend Orchestrator | Frontend: browser-based DAG engine; Backend: BullMQ orchestrator for autonomous/triggered execution |
| Realtime updates | Polling (MVP) → SSE (Phase 2) | No extra infra needed |
| Audio processing | FFmpeg in worker | All audio nodes use FFmpeg, not AI |
| Credit pricing | 1 credit = $0.02 | Composite model identifiers for variable pricing (e.g., `"gpt-image:high"`, `"flux:2K"`); `VARIABLE_PRICING_MODELS` in `model-options.ts`; `buildCreditModelIdentifier()` in helpers.ts + route handlers; dynamic markup via `cost_markup_percent` app setting; credit anomaly tracking via `credit_anomalies` table; FFmpeg processing nodes tiered: light 1 CR (trim, fade, loop, transcode, adjust-volume, trim-audio), medium 2 CR (resize, speed-ramp, merge, mix, social-format), heavy 3 CR (combine-videos, add-captions); entity nodes (character, face, object, location) support model selection for reference image generation |
| Voice Extractor | ElevenLabs via KIE.ai | Isolates voice from any audio, removes background noise |
| Speech-to-Text | ElevenLabs STT via KIE.ai | Transcription with diarization + audio event tagging (provider option on transcribe node) |
| Text-to-Dialogue | ElevenLabs Dialogue V3 via KIE.ai | Multi-speaker TTS — each dialogue line gets a different voice, outputs single audio file |
| Video composition | Remotion (`packages/remotion/`) | Scene graph renderer + after-effects renderer + lottie-overlay renderer + 3d-title renderer + motion-graphics renderer + composite renderer + legacy template converters via BullMQ worker |
| AI composition | Claude Sonnet → Scene Graph JSON | Natural language → track-based video composition (2 credits) |
| After Effects | Claude Sonnet → Effect Plan JSON | AI-generated post-processing (color grade, vignette, grain, noise, letterbox, animated-blur, trail, motion-blur) applied to video (2 credits), CSS `filter:blur()` for motion-blur, OffthreadVideo ghost layers for trail |
| Lottie Overlay | Claude Sonnet → Overlay Plan JSON | AI-placed timed Lottie animations over video (2 credits), `@remotion/lottie` + `delayRender`/`continueRender` per overlay |
| 3D Title | Claude Sonnet → 3D Title Plan JSON | AI-generated animated 3D text scenes with camera, lighting, particles (3 credits), `@remotion/three` + Three.js + `@react-three/drei`, max 60s |
| Motion Graphics | Claude Sonnet → Motion Graphics Plan JSON | AI-generated 2D motion graphics: lower thirds, title cards, kinetic typography, animated shapes/SVG paths (2 credits), pure Remotion primitives + `FONT_MAP` |
| Composite | Client-side plan builder → Composite Plan JSON | Multi-layer video compositor: PiP, split screen, overlays with positioning/opacity/blend modes (0 credits), no AI, no backend route — plan built entirely in frontend DAG executor |
| Multi-plan rendering | `POST /v1/render-video/plan` | Generic `{ planType, plan }` envelope — any composer node can feed plans to Render Video |
| Video extend | VEO Extend + Runway Extend via KIE.ai | `POST /v1/extend-video` (40/32 credits), requires upstream `kieTaskId` from VEO/Runway generation; new `extend-video` node type with provider-specific params (model/seeds for VEO, quality for Runway) |
| Media processing | FFmpeg in worker | 13 processing nodes (combine, merge, extract, captions, resize, trim, speed-ramp, loop, fade, mix-audio, adjust-volume, video-upscale, extract-frame), 0 credits |
| Image generation | Per-model params via `model-options.ts` | Config panel layout: Provider → Prompt → Style → Negative Prompt → Assets → Model Settings; style uses `IMAGE_STYLE_PRESETS` dropdown (16 presets) + "Custom..." free text; aspect ratios, resolution (Flux/Nano Banana 2), quality (GPT Image/Seedream) filtered per provider; Nano Banana v1 uses `image_size` (not `aspect_ratio`) and has no `resolution`; Nano Banana 2 uses native `aspect_ratio` with 1K/2K/4K resolution; `output_format` only sent to Nano Banana family; Flux Kontext/Max use own aspect ratio set (1:1, 16:9, 9:16, 4:3, 3:4, 21:9); style appended to prompt at execution; `negative_prompt` sent natively for imagen4/ideogram/qwen, appended as "Avoid: ..." for others; Ideogram uses `reference_image_urls` for character refs; reference image UI hidden for models that don't support it (`MODELS_WITH_REFERENCE_IMAGE_SUPPORT`: nano-banana, nano-banana-pro, ideogram only) |
| LLM routing | KIE.ai unified client + Anthropic fallback | `packages/shared/src/llm-models.ts` (model registry), `backend/src/lib/llm-client.ts` (`llmComplete()` + `llmStream()`, 3 format adapters: chat-completions, messages, responses); 7 models across 3 tiers (economy/standard/premium); all 11 LLM routes + translate migrated; `LlmModelSelect` component in all LLM config panels; `LlmFeature` type covers 11 features; `buildLlmCreditIdentifier()` for tiered pricing; `resolveLlmCreditId()` reads `llmModel` from raw body before Zod strips it |
| AI prompt wizard | LLM-powered interactive prompt builder | `POST /v1/prompt-helper/wizard` — two-action flow (analyze + generate); `PromptHelperButton` (pink sparkles, gated behind `hasCredits()` + `isWizardSupported()`); three-phase `PromptHelperDialog` (Input → Review Form → Result); AI picks 3-5 categories per node type (image 7, video 6, music 6, audio 4) and generates pre-filled questions with curated options; reference image role assignment (multi-select); model recommendation with one-click Apply; categories + provider capabilities in `packages/shared/src/prompt-wizard-categories.ts`; default model `gemini-3-flash` (economy tier); 2 credits per full wizard flow |
| Translation | Gemini Flash via KIE.ai | Creative prompt translation (migrated from Replicate to unified LLM client) |
| Composition preview | `@remotion/player` in frontend | Lazy-loaded Player preview for After Effects + Motion Graphics config panels; `@remotion-pkg` Vite alias resolves `packages/remotion/src`; `resolve.dedupe` prevents duplicate remotion bundles |
| Undo/redo | Zustand snapshot stack (50 max), 300ms debounce | `undo-flags.ts` shared skip flag prevents execution updates (status/progress/results via `EXECUTION_DATA_KEYS`) from creating undo entries; `_isRestoring` flag prevents restore from triggering subscription; `loadGeneration` counter clears history only on workflow load/switch, not on auto-save `markClean()` |
| Settings cache | 60s TTL, stampede-safe | Reduce DB queries, mutex prevents stampede |
| TTS models | ElevenLabs v3 (default), Turbo v2.5, Multilingual v2 | v3 (`eleven_v3`) supports `[audio tags]` for emotions/SFX; v2 models don't — worker `stripAudioTags()` removes `[...]` before sending to v2; v3 always routes through direct ElevenLabs API (never KIE); frontend `TagTextarea` shows persistent warning when audio tags + v2 model |
| TTS languages | Model-aware lists in `audio-tags.ts` | `getLanguagesForModel(provider)` returns correct set per model: Multilingual v2 = 29, Flash v2.5 = 32, v3 = 46 (adds Hebrew, Thai, Bengali, etc.); `ALL_LANGUAGES` for non-model-specific dropdowns (dialogue, dubbing, voice browser) |
| Voice browser | ElevenLabs v2 API → VoiceBrowser dialog | `GET /v1/voices` (public, 6hr cache, stampede-safe), `useVoices()` hook, dialog with search/gender/accent/age/language/sort filters + audio preview; `DIALOGUE_VOICE_IDS` restricts dialogue node to 20 supported voices; fallback to static 52-voice list when no API key |
| Voice cloning | ElevenLabs Instant Clone → direct TTS | `POST /v1/voice-clones` (multipart, 5 credits), `voice_clones` DB table with RLS; custom voices use `directElevenLabsTTS()` bypassing KIE.ai; TTS node `voiceType: "premade" \| "custom"` field; Voice Browser "My Voices" tab with record/upload UI (MediaRecorder API) |
| Voice Changer | ElevenLabs Speech-to-Speech direct API | `POST /v1/voice-changer` (4 credits), audio input + target voice → audio output preserving emotion/delivery; uses `POST /v1/speech-to-speech/{voice_id}` multipart sync API |
| Dubbing | ElevenLabs Dubbing direct API | `POST /v1/dubbing` (8 credits), audio + target language → translated audio preserving speaker identity; async with polling (`startDubbing` → `waitForDubbing` → `downloadDubbedAudio`) |
| Voice Remix | ElevenLabs Text-to-Voice direct API | `POST /v1/voice-remix` (4 credits), natural language voice description + preview text → audio preview; uses `POST /v1/text-to-voice/create-previews` |
| Voice Design | ElevenLabs Text-to-Voice Design direct API | `POST /v1/voice-design` (5 credits), full controls: model (multilingual v2/english v2/turbo v2.5), loudness, guidance_scale, seed, quality, should_enhance; outputs audio + `generatedVoiceId`; uses `POST /v1/text-to-voice/design`; node has dual output handles (`audio` + `voiceId`) |
| Forced Alignment | ElevenLabs Forced Alignment direct API | `POST /v1/forced-alignment` (3 credits), audio + transcript → word-level timestamps JSON; output is data (not audio) |
| Suno metatags | `suno-tags.ts` + `TagTextarea` | Autocomplete for `[Verse]`, `[Chorus]`, genre tags, etc. in lyrics fields; `TagTextarea` component with portal-rendered dropdown, supports both Suno metatags and ElevenLabs audio tags via `customTags` prop |
| Aspect ratio selector | Visual SVG tile grid | `AspectRatioSelector` component with dynamically generated SVG ratio icons; responsive grid (2-col ≤2 options, 3-col otherwise); ARIA `radiogroup`; used across all image/video/composition config panels replacing plain `<Select>` dropdowns |
| Canvas layout | ELKjs layered algorithm | `elkjs` replaces custom tidy-up; uses `node.measured` dimensions for size-aware layout; `elk.algorithm: "layered"`, direction RIGHT, orthogonal edge routing; supports selection-mode (2+ selected) or all-nodes mode; sticky notes excluded |
| Flexible app I/O | Curated presentation inputs/outputs | Nodes opt in via `presentationInput`/`presentationOutput` flags on node data; `NodePickerDialog` for selection; `@dnd-kit/sortable` drag-and-drop ordering; `presentationSettings.inputOrder`/`outputOrder`/`cardMeta` in workflow store |
| Tier-based parallelism | `TIER_PARALLELISM` in `stripe-config.ts` / `pricing-data.ts` | Per-execution concurrency limit by user tier: free=2, basic=4, standard=6, pro=10, business=12. Backend orchestrator fetches `profiles.tier` at execution start; frontend fan-out reads cached tier from `use-auth.ts`. Self-hosted editions (community/business) get env ceiling (default 12). `MAX_CONCURRENT_NODES_PER_EXECUTION` env var acts as hard ceiling. |
| Workflow orchestrator | BullMQ `"workflow-orchestration"` queue | Server-side DAG execution: topological sort → level-by-level parallel execution → per-node state tracking; 3 execution categories: worker-queued (40+ types via existing BullMQ queues), sync HTTP (13 routes: 7 AI + 6 social via internal fetch), inline (combine-text, split-text, composite); concurrency 2; 30min per-node timeout, 60min per-workflow; two stop modes: "cancelled" (immediate) and "stopping" (finish current level then stop) |
| Webhook triggers | Token-based auth, no user auth needed | `POST /v1/webhooks/:token` (public route), 32-byte hex token per trigger, rate limited 10/min per token; creates execution + enqueues orchestrator |
| Schedule triggers | Cron expressions + interval strings | `schedule-cron.ts` checks every 60s, supports 5-field cron + simple intervals ("5m", "1h", "1d"); respects `maxExecutions` limit; skips if workflow already running |
| Sub-workflow execution | Recursive with depth limit 5 | `sub-workflow-handler.ts`: loads referenced workflow, filters to selected route's reachable nodes (BFS), executes with same orchestrator logic; cycle detection via `workflowId:routeId` set |
| Single-node execution history | Jobs tagged with workflowId | Frontend `setCurrentWorkflowId()` + `withWorkflowId()` inject workflowId into all job-creating API calls; backend `extractWorkflowId(req.body)` reads it before Zod strips it; `GET /v1/workflows/:id/executions` merges `workflow_executions` + standalone `jobs` (where `workflow_execution_id IS NULL`); standalone jobs shown as `triggerType: "single-node"` with synthetic nodeStates |
| Shared package | `packages/shared/` with relative imports | Deduplicates ~500 lines of pure logic (prompt building, model constants, templates, ancestor refs, credit identifiers) between frontend DAG executor and backend orchestrator. Frontend resolves via Vite alias; backend uses relative imports (NOT path aliases — `tsc` doesn't rewrite them). Backend `rootDir: ".."` so dist output is `dist/backend/src/`. Dockerfile copies `packages/shared/` into build stages. |
| Sora Characters | KIE.ai `sora-2-characters` + `sora-2-characters-pro` | `sora-character` node: extract reusable `character_id` from video (standard: upload clip, pro: reference Sora task ID + timestamps). Output is non-URL string (follows voice-design pattern). `character_id_list` (max 5) supported on Sora I2V/T2V/Storyboard via `characters` input handle with multi-connection aggregation. 5 credits per extraction. |
| Social media publishing | OAuth 2.0 + platform APIs | 6 platforms: Instagram, TikTok, YouTube, LinkedIn, X, Facebook. OAuth popup flow with PKCE (X), CSRF state param. Tokens AES-256-GCM encrypted at rest (`SOCIAL_ENCRYPTION_KEY`). `social_connections` table (1 account per user+platform). Publishing via sync HTTP nodes in orchestrator. 1 credit per post. |
| FreeCut editor | Iframe + postMessage bridge | `freecut-editor-modal.tsx` embeds FreeCut; universal "Edit in FreeCut" scissors button on all 22 video nodes; `freecutEdit` store state triggers modal; edited video uploaded to R2 as new result version; 0 credits |
| Deployment | Railway + single Dockerfile | `dev` branch → staging (`next.nodaro.ai`); `main` branch → production (`app.nodaro.ai`). Single multi-stage Dockerfile at repo root builds backend, frontend, and Remotion. Caddy reverse proxy in front. **When adding new `VITE_*` env vars, always add both `ARG` and `ENV` lines to the Dockerfile** — Vite inlines them at build time, so they must be present during Docker build. |

---

## Active TODOs
- [ ] Phase 6 Templates (preset workflow templates)
- [ ] Version history per node
- [ ] /v1/available-models endpoint (filter by edition + API keys)
- [ ] Build from Prompt: MVP + Director Mode versions
- [ ] Shot Node as companion to Scene Node ("Director Mode")
- [x] New KIE models: Nano Banana 2, Seedream 5 Lite (image); Flux Kontext/Max (image edit); Runway KIE (video); Luma Modify (V2V); VEO/Runway Extend (video extend); VEO 1080p/4K upscale
- [x] New KIE models Phase 2: Ideogram V3 (image); Kling 3.0 motion control; Topaz 4K/8K tiers; Sora watermark remover; 7 Suno ops (mashup, replace-section, style-boost, add-instrumental, add-vocals, convert-wav, upload-extend); Speech-to-Video (Wan 2.2); Sora Storyboard
- [x] TTS voice browser with categories, search, audio previews
- [x] Voice cloning (record/upload audio → ElevenLabs instant clone → custom voice for TTS)
- [x] Backend workflow execution engine (orchestrator, webhook triggers, schedule triggers)
- [x] Execution history UI (per-workflow execution list + per-node status + single-node runs)
- [x] Social media integrations (Instagram, TikTok, YouTube, LinkedIn, X, Facebook — OAuth + publishing nodes + integrations page)
- [x] Admin subscription health page + Stripe self-healing
- [x] Published apps / mini-apps system (versioning, embedding, app runner)
- [x] Preview node (inspect connected asset values in workflow editor)
- [x] Copy/paste/cut workflow nodes + clipboard workflow import
- [x] Credit audit across all KIE record endpoints
- [x] Stripe production go-live
- [x] Video generation with start+end frames (VEO, Kling, MiniMax, Hailuo, Bytedance)
- [x] Translation: AI-powered via unified LLM client (replaced Google Translate)
- [x] Project Folders (folder_id on workflows, drag-drop folder UI)
- [x] Scene Node (visual scene editor with character/object/location refs)
- [x] Unified LLM layer with tiered model selection (7 models, 3 tiers, 3 API formats)
- [x] AI prompt helper for node config panels (LLM-powered prompt enhancement)
- [x] Flexible app I/O — any node as curated input/output with config modals
- [x] ELKjs size-aware layout (replaced custom tidy-up)
- [x] Visual aspect ratio selector (SVG tile grid across all config panels)
- [x] VEO 3/3.1 aspect ratio, seed config, generateAudio toggle, Fast T2V variant
- [x] Credit audit: actual-charges mode, anomaly tracking, KIE credits dashboard
- [x] Execution parity audit (frontend DAG ↔ backend orchestrator fully aligned)
- [x] Dynamic credit pricing from admin markup setting
- [x] Public docs site (GitHub Pages) — internal specs moved to `specs/`
- [x] Kling 3.0 multi-shot polish (config panel, motionPrompt, end frame hide)
- [x] Sora Character node (extract reusable character IDs from video, standard + pro modes)
- [x] Sora character_id_list integration (I2V, T2V, Storyboard — up to 5 characters per generation)
- [x] Credit system improvements: FFmpeg tiered pricing (1/2/3 CR), dynamic credit labels, entity node model selection, scene node credit badges
- [x] Route-scoped preset mode (run only a route in presentation mode + published apps)
- [x] Prompt Wizard (interactive AI prompt builder with category questions, model recommendation, reference image roles)
- [x] Extract Frame node (video→image frame extraction, 3 modes: first/last/timestamp, 1 CR)
- [x] Video node display name audit (de-vendored Sora/Suno prefixes, standardized verb-object order)
- [x] Component marketplace preview modal — single click on a component card opens a preview (description + inputs/outputs/exposed settings + media), double click adds directly; popup marketplace shows description in place of creator name
- [x] Dropped edge "runs" concept (useAllResults/runsExpression) — generatedResults is now a single deterministic ordered flat list

---

*Last updated: 2026-04-15*
*Version: 1.78.0*
