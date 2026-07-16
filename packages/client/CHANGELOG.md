# @nodaro/sdk

## 1.4.0

### Minor Changes

- ad8606e: Voice Changer Pro interactive flow on `client.voices`: adds `analyze()` (detect speakers without recasting — `POST /v1/voice-changer-pro/analyze`), extends `recast()` with `output: "video" | "stems"` and `analysis` (pass a prior analyze result to skip re-detection), and adds `exportMix()` (render a mixed set of stems into the final video — `POST /v1/voice-changer-pro/export`). New exported types: `VcpAnalyzeInput`, `VcpAnalysis`, `VcpAnalysisSpeaker`, `VcpExportInput`, `VcpExportTrack`. Together these let any SDK consumer build a full VCP editor (detect → pick a voice per speaker → mix tracks → export), not just the one-shot recast.

## 1.3.0

### Minor Changes

- 774aa2d: Add reasoning-effort control and 6 new KIE LLM models (gpt-5.6-luna/terra/sol, gpt-5.5, claude-sonnet-5, claude-opus-4.8) end-to-end.

  - `@nodaro/shared`: new `LLM_REASONING_EFFORTS` (`none`/`low`/`medium`/`high`/`xhigh`/`max`) + `LlmReasoningEffort` type, `EFFORT_TIER_BUMP` set, and `effectiveReasoningEffort()` helper (clamps a requested effort down to the highest level the target model actually supports). `LLM_MODELS` gains 6 new entries plus per-model `reasoningEfforts`, `supportsTemperature`, and `preferKie` capability fields. `buildLlmCreditIdentifier()` / `resolveLlmCreditId()` take an optional `reasoningEffort` third argument — `xhigh`/`max` (after clamping) bill one credit tier up (economy→standard, standard→premium, premium stays premium); `high` is the Claude-family server default and never bumps.
  - `@nodaro/sdk`: prompt-helper wizard resources' `CommonInput` gains an optional `reasoningEffort` field, forwarded automatically by the existing request-builder spread.
  - `@nodaro/cli`: `nodaro prompt` wizard subcommands gain a `--reasoning-effort <level>` flag (model-dependent; accepts `none|low|medium|high|xhigh|max`).

  `grok-4.5` was evaluated but deferred — its KIE chat endpoint is not yet live, so no registry entry, rate row, or docs were added for it in this release.

### Patch Changes

- Updated dependencies [774aa2d]
  - @nodaro/shared@1.9.0

## 1.2.0

### Minor Changes

- de3f995: Voice Changer Pro: `VoiceChangerProInput.orderedVoices` now accepts `null` entries (keep-slots). A `null` at position i means "keep speaker i's original voice" instead of recasting it. Additive — existing non-null callers are unaffected.

## 1.1.2

### Patch Changes

- 50e2721: Documentation-only: voice changer pro JSDoc now describes behavior without implementation internals.
- Updated dependencies [910fd2d]
  - @nodaro/shared@1.5.0

## 1.1.1

### Patch Changes

- 8661d4a: Registry restore after the license-split wipe: all pre-split packages were removed from npm (their Apache grants covered prompt craft that now lives in FSL-licensed `@nodaro/prompts`). npm permanently burns unpublished version numbers, so every package takes a patch bump. No code changes.
- Updated dependencies [8661d4a]
  - @nodaro/shared@1.4.1
  - @nodaro/prompts@1.0.1

## 1.1.0

### Minor Changes

- cd33c25: License split: creative/prompt modules (person + picker catalogs with hints, identity-lock, entity prompt builders, brand presets, prompt/reference assembly) moved from Apache-licensed `@nodaro/shared` into the new **`@nodaro/prompts`** package (FSL-1.1-Apache-2.0 — free for any non-competing use, Apache after two years per version). `@nodaro/shared` keeps the structural public contract (types, wire enums, model catalog, new `entity-asset-types` vocabulary, hint-graph types). `@nodaro/sdk` now depends on `@nodaro/prompts` and keeps its full API — `buildPersonHints`, `buildPersonSeedPrompt`, and the `PEOPLE` catalog re-exports are unchanged for consumers. Shipped as minors while the packages have no external consumers (registry copies of prior versions are being replaced).

### Patch Changes

- Updated dependencies [cd33c25]
  - @nodaro/shared@1.4.0

## 1.0.3

### Patch Changes

- 37f1805: No functional changes. Republish so the npm provenance attestations reference the repository's current (post-history-rewrite) source commits — earlier versions' attested commit links point at rewritten-away SHAs.
- Updated dependencies [37f1805]
  - @nodaro/shared@1.2.1

## 1.0.2

### Patch Changes

- 6bcdb96: README overhaul for agent-first onboarding: "LLM quick start" moved directly after the server quick start and split into a **universal primer** (reusable in any project; also published raw as `sdk-agent-primer.txt` with `curl | pbcopy` one-liners) and a separate **example project brief** ("animated postcard" — image shown immediately, live % progress via `onProgress`, cancel via `AbortSignal`). The primer names recommended models (`nano-banana-2`, `seedance-2-fast` @ 4s — the platform default) and links full model lists + runtime discovery. New "Connect via MCP" section with per-client connect badges, the Claude Code one-liner, and the MCP-delivered Skills (Film Director / Video Director). Credential cells now deep-link `app.nodaro.ai/settings/api` and `/settings/developer-apps`.
- ccc07e7: README agent primer: published as a raw copyable file (`sdk-agent-primer.txt` on the docs site) with `curl | pbcopy` one-liners, and extended with UX rules for generation apps — show intermediate results while later steps run, drive a live progress bar via `runAndWait`'s `onProgress` (or `jobs.getStatus`), and wire an `AbortSignal` for cancel.
- Updated dependencies [6bcdb96]
  - @nodaro/shared@1.2.0

## 1.0.1

### Patch Changes

- efba386: README: add a "Getting credentials" guide (personal API token vs OAuth app vs self-hosted Supabase mode — and which to use when), a "Run AI nodes directly" quick start showing `nodes.runAndWait`, the full 22-resource table, live docs links, and a "Building with an LLM" section with a paste-into-your-agent primer (auth, core pattern, a complete animated-postcard example, credit/error rules, llms.txt pointer). The hosted base URL in examples is now app.nodaro.ai.

## 1.0.0

### Major Changes

- a33d6ab: Remove the `popularIds` field from `presets.listFactory()` / `GET /v1/node-presets/factory`. The static "Popular" preset band has been removed in favor of a user-driven Favorites feature; `popularIds` is no longer returned.

### Minor Changes

- ca65d28: Add typed support for the new `assemble-narrated-video` node: `AssembleNarratedVideoParams` with typed `client.nodes.run`/`runAndWait` overloads in `@nodaro/sdk`, and the `assembleNarratedVideoCredits` credit estimator (`3 + ceil(blocks/6)`) exported from `@nodaro/shared`.
- 5585889: Admins can now share/unshare community listings via the SDK + CLI. `@nodaro/sdk`: `community.publish()`, `community.unpublish()`, `community.sharedListing()`. `@nodaro/cli`: `community publish/unpublish/shared-status`. (All require an admin token; publishing requires owning the source entity and, for characters, a likeness attestation.)
- 3e14899: Add the `community` resource: browse, get, favorites, clone, favorite, and report shared characters/locations/objects. (Publishing is admin-only via the editor and is intentionally not exposed in the SDK.)
- 5c184c3: Add an optional `duration` (seconds) field to `GenerateCreatureMotionInput` and `GenerateObjectMotionInput`, mirroring `generate-video`'s per-model i2v duration lever. The value is validated server-side against the chosen provider's allowed durations (`POST /v1/generate-creature-motion` / `/v1/generate-object-motion`) and passed through to the underlying video model; when omitted the model's own default is used, so there is no behavior change for current callers. Longer clips on duration-priced models (kling, kling-3.0, wan-i2v, seedance, …) reserve credits at the correct duration tier.
- 4909967: Add `CreaturesResource` to `@nodaro/sdk`, exposed as `client.creatures`, with 13 methods (`list` / `listArchived` / `get` / `create` / `update` / `delete` / `permanentDelete` / `restore` / `generate` / `generateAsset` / `generateMotion` / `approveMainImage` / `recaption`). Mirrors `ObjectsResource` against the deployed creature routes (`/v1/creatures*` + `/v1/generate-creature*`).

  Creature-specific deltas vs objects:

  - `species` free-text field (the creature subject) — the primary differentiator object has no equivalent of
  - `poses` asset bucket where object has `materials`
  - 4-value asset-type enum (angles / poses / variations / custom) — NO `motion` value (creature motion flows through the dedicated `generate-creature-motion` endpoint)
  - free-text `category` (a creature can be any type — not object's fixed 10-value enum)
  - `attachToCreatureId` replaces `attachToObjectId`
  - `generate-motion` reuses the object aspect-ratio enum (5-value: 1:1 / 3:4 / 16:9 / 9:16 / 4:3) and the object motion defaults (provider `kling-turbo` + aspect ratio `1:1`)

  New public exports: `Creature`, `CreatureDetail`, `CreatureReferencePhoto`, `CreatureReferencePhotoKind`, `CreateCreatureInput`, `UpdateCreatureInput`, `UpsertCreatureInput`, `Generate*` input/result types, `CreatureAssetType`, `CreatureAttachColumn`, `CreatureAspectRatio`, plus the runtime tuples `CREATURE_ASSET_TYPES` / `CREATURE_ATTACH_COLUMNS` / `CREATURE_ASPECT_OPTIONS` / `CREATURE_ASPECT_DEFAULTS`.

- ddeb67a: Initial public release.

  - `@nodaro/shared` — types, model registries, prompt helpers, presentation utils, edge/range logic, identity-lock helpers shared across the Nodaro stack.
  - `@nodaro/sdk` — typed REST client for the Nodaro API. Three auth modes (StaticTokenAuth, supabaseAuth, CallbackAuth), 7 resources (workflows, projects, jobs, executions, nodes, developerApps, oauth), typed error hierarchy.

- e6a514f: Added `client.locations` SDK resource and `nodaro locations` CLI subcommand group.

  New SDK methods: `list`, `get`, `create`, `update`, `delete` (soft), `restore`, `generate`, `generateAsset`, `approveMainImage`, `recaption`.

  New CLI subcommands: `list` (supports `--archived`), `get`, `create`, `update`, `delete`, `restore`, `generate` (supports `--watch`), `generate-asset`, `approve-main-image`, `recaption`.

  **Breaking change:** `client.locations.delete(id)` now soft-deletes (returns `{ success: true, archived: true }`). Hard-delete is no longer exposed via SDK; use the archive gallery in the editor for permanent destruction.

  Atmosphere motion clips + archive gallery + 5 environmental tabs ship in PR-2.

- 216f3bb: Added atmosphere motion clip support to Location Studio.

  New SDK method: `client.locations.generateMotion()`.

  New CLI subcommand: `nodaro locations generate-motion`.

  Other changes shipping in this release:

  - Location Studio modal now has all 7 tabs (Appearance + Time of Day + Weather + Seasons + Angles + Lighting + Motion)
  - Archive gallery at `/library/locations` with restore + permanent-delete (typed-name confirmation)
  - 11 locale catalogs for the 46 preset variant labels (English placeholders pending translator pass)
  - Full `docs/location-platform.md` and rewritten `docs/nodes/assets/location.md`
  - New MCP tool `generate_location_motion` (scope: `workflows:execute`)
  - 6th badge on canvas location node (atmosphere motions, amber tint to distinguish video from image badges)

- 9798fad: Add Object Studio surface to SDK + CLI.

  - `@nodaro/sdk`: new `ObjectsResource` exposed as `client.objects`, with 13 methods (`list` / `listArchived` / `get` / `create` / `update` / `delete` / `permanentDelete` / `restore` / `generate` / `generateAsset` / `generateMotion` / `approveMainImage` / `recaption`).
  - `@nodaro/cli`: new `objects:*` subcommand group with 11 commands. `--watch` polls completion inline.

  Object-specific deltas vs locations:

  - 10-value category enum (furniture / vehicle / weapon / food / clothing / electronics / nature / tool / animal / other)
  - 5-value asset-type enum (angles / materials / variations / motion / custom) → 4 attach columns (motion routes to `motion_clips`)
  - 5-value aspect-ratio union (adds 4:3 for product-showcase framing)
  - `generate-motion` defaults: provider `kling-turbo` + aspect ratio `1:1` (not the location `kling` / `16:9` cinematic defaults)
  - `delete --permanent` flag for hard-delete (archived rows only); mirrors SDK's `permanentDelete()`
  - `approve-main-image --expected-updated-at` for optimistic-concurrency-guarded approval
  - `--seed-prompt-hint` on `generate` / `generate-asset` / `generate-motion` (Pass 7 F-77 parameter-picker pass-through)

- acd2564: Add a facial-geometry layer to the structured Person catalog in `@nodaro/shared` and surface it through `@nodaro/sdk`.

  `@nodaro/shared`: new `PersonValue` fields + `PEOPLE` catalog options for a facial-geometry / feature-ratio control layer under the Face section — `cheekbones`, `facialFullness`, `eyelidType`, `canthalTilt`, `eyeSpacing`, `eyeSetBrow`, `noseTip`, and the split `lipFullness` + `lipShape` (the old combined `lips` is kept as a deprecated alias that still resolves). Each option contributes a precise prompt fragment via `buildPersonHints`; neutral options inject nothing. New export `migratePersonValue(value)` relocates legacy `eyeShape` / `lips` values onto the new fields. Backward compatible — option ids are stable, so existing data emits identical prompts.

  `@nodaro/sdk`: re-export `PersonValue`, `PEOPLE`, `PERSON_DIMENSION_ORDER`, `PERSON_DIMENSION_LABELS`, and `buildPersonHints`, plus a new `buildPersonSeedPrompt(value)` helper that collapses a `PersonValue` into the comma-joined seed-prompt fragment for `characters.generate({ seedPrompt })`.

- fbcd7c8: Add picker-catalog discovery: `client.pickerCatalogs` (`list`/`get`) over the new public `/v1/picker-catalogs` endpoints, plus `summarizePickerCatalogs`/`projectPickerCatalog` helpers in `@nodaro/shared`.
- 5380a50: Add chat methods to the pipelines resource (Phase 1D.2b Guided Mode, §5.9):

  - `pipelines.chatStage(pipelineId, stage, message)` — send a refinement message to the Showrunner Refinement Director; persists user+assistant turns and returns the assistant's reply plus an optional `proposed_change`.
  - `pipelines.applyChatProposal(pipelineId, stage, turnId)` — accept a proposed `edit_artifact` change from a prior assistant turn; the backend validates the JSON Patch, inserts a new attempt, and flips the stage to approved.
  - `pipelines.getStageChat(pipelineId, stage)` — fetch the chat history for a stage (empty array when no turns exist yet).

- 55e3782: Add `client.pipelines.branch(id, { fromStage })` — create a new pipeline by re-running from a completed stage (§5.9).
- bed0093: Rename `client.collect` → `client.reduce` (BREAKING for dev). The existing fan-in reducer node was misnamed "Collect" — its function is to reduce N upstream values into one (Pick best LLM, Concat, First-non-empty, Count, Vote, Merge JSON). Renamed to "Reduce" both to fit the canonical functional-programming term AND to free the "Collect" name for a true type-bucketing aggregator landing in a parallel PR. The route is now `POST /v1/reduce`, the MCP tool is `reduce`, and the SDK exposes `client.reduce.run(...)`. Saved workflows referencing the old `"collect"` node type are auto-migrated on load via a backward-compat shim in the orchestrator (removable once all workflows are migrated; companion DB migration 151 rewrites `workflows.data` JSON + `model_pricing` rows in one pass). Type renames: `CollectStrategyId` → `ReduceStrategyId`, `CollectMeta` → `ReduceMeta`, `CollectInput` → `ReduceInput`, `CollectResult` → `ReduceResult`, `CollectResource` → `ReduceResource`.
- 93adc04: voices.recast(): per-voice recast settings (stability/similarity/style/speakerBoost/seed/volumeMode/volume) + separationQuality + node-level voiceFx (reverb/echo applied to the combined recast voices before the background is mixed back) + node-level musicVolumeMode / musicVolume (level of the preserved background music — match / normalize / manual %)
- 7f38813: Add `voices.recast()` for the multi-speaker Voice Recast capability (`POST /v1/voice-recast`). Recasts each detected speaker to the voice at its position in `orderedVoices`; speakers beyond the array keep their original voice. Accepts `audioUrl` or `videoUrl`, optional `model`, `preserveBackground`, and `removeBackgroundNoise`. Cloud-only, runs async — poll `jobs.get(jobId)`. New public export: `VoiceRecastInput`.

### Patch Changes

- c42a82f: Centralize community listing types in `@nodaro/shared` (single source of truth, re-exported by `@nodaro/sdk`), and add a `community` command group to `@nodaro/cli` (`browse`, `get`, `favorites`, `clone`, `favorite`, `report`) mirroring the SDK resource. Publishing remains admin/editor-only and is intentionally not exposed.
- 0f8bb8b: Fix: surface re-exports that tsup was tree-shaking out of `@nodaro/sdk`'s built bundle. `buildPersonSeedPrompt`, `buildPersonHints`, `PEOPLE`, `PERSON_DIMENSION_ORDER`, `PERSON_DIMENSION_LABELS`, and the `PersonValue` type — plus the pre-existing `CHARACTER_STYLES` value and `EntityStyle` type — were declared/re-exported in the characters resource but never re-exported from `src/index.ts` (which re-exports characters symbols selectively, not `export *`). As a result they were absent from the bundle and `import { buildPersonSeedPrompt } from "@nodaro/sdk"` did not resolve. All are now re-exported from the package entry point.
- bcf5e08: Add `jobs.getStatus(id)` — a lean job-status fetch hitting `GET /v1/jobs/:id/status`. Returns only `id`, `status`, `progress`, `output_data`, and `error_message` (no `input_data`, cost columns, or timestamps), making it cheaper for poll loops than `jobs.get(id)`. Additive and non-breaking; `jobs.get(id)` is unchanged.
- e0aec7e: Correct the license statement in the `@nodaro/shared` and `@nodaro/sdk` READMEs (the packages are Apache-2.0, not the repository-root Sustainable Use License) and add `repository`/`homepage`/`bugs` metadata to all three published package.json files so npm links back to the source monorepo.
- Updated dependencies [ca65d28]
- Updated dependencies [c42a82f]
- Updated dependencies [5585889]
- Updated dependencies [4260c1e]
- Updated dependencies [64d6d81]
- Updated dependencies [ddeb67a]
- Updated dependencies [acd2564]
- Updated dependencies [7a38259]
- Updated dependencies [b3f214b]
- Updated dependencies [fbcd7c8]
- Updated dependencies [e0aec7e]
  - @nodaro/shared@1.1.0
