# @nodaro/shared

## 1.9.0

### Minor Changes

- 774aa2d: Add reasoning-effort control and 6 new KIE LLM models (gpt-5.6-luna/terra/sol, gpt-5.5, claude-sonnet-5, claude-opus-4.8) end-to-end.

  - `@nodaro/shared`: new `LLM_REASONING_EFFORTS` (`none`/`low`/`medium`/`high`/`xhigh`/`max`) + `LlmReasoningEffort` type, `EFFORT_TIER_BUMP` set, and `effectiveReasoningEffort()` helper (clamps a requested effort down to the highest level the target model actually supports). `LLM_MODELS` gains 6 new entries plus per-model `reasoningEfforts`, `supportsTemperature`, and `preferKie` capability fields. `buildLlmCreditIdentifier()` / `resolveLlmCreditId()` take an optional `reasoningEffort` third argument — `xhigh`/`max` (after clamping) bill one credit tier up (economy→standard, standard→premium, premium stays premium); `high` is the Claude-family server default and never bumps.
  - `@nodaro/sdk`: prompt-helper wizard resources' `CommonInput` gains an optional `reasoningEffort` field, forwarded automatically by the existing request-builder spread.
  - `@nodaro/cli`: `nodaro prompt` wizard subcommands gain a `--reasoning-effort <level>` flag (model-dependent; accepts `none|low|medium|high|xhigh|max`).

  `grok-4.5` was evaluated but deferred — its KIE chat endpoint is not yet live, so no registry entry, rate row, or docs were added for it in this release.

## 1.8.0

### Minor Changes

- 39bdbd7: Add `edit-video-pro` to `VIDEO_PRODUCER_TYPES` — the new replace-span node outputs video, so canvas validators and backend asset-typing accept its output anywhere a video is accepted.
- da6af59: `SEEDANCE_2_EXTEND_STITCH` gains `referenceTailSeconds` (1) — the extend-video worker now passes only the source's last second as the `@video_1` reference (with the source's last frame as the i2v first-frame anchor), and the existing `trimTailFrames`/`trimHeadFrames` are documented as the smart-cut fallback trims.

## 1.7.0

### Minor Changes

- aac8660: HappyHorse 1.1: the `happyhorse` / `happyhorse-i2v` / `happyhorse-ref2v` ids now target KIE's `happyhorse-1-1/*` endpoints (1.0 was delisted; identical parameter surface, so existing workflows keep working). Catalog gains the model's full 9-ratio aspect set (adds `4:5`, `5:4`, `21:9`, `9:21` for T2V/Ref2V) and per-second pricing tiers (`<id>:<N>s:<720p|1080p>`, N = 3–15) in `DURATION_PRICED_PROVIDERS` / `VIDEO_DURATION_TIERS` / `RESOLUTION_DURATION_PRICING`. Prompt-wizard capability blurbs updated accordingly.

## 1.6.0

### Minor Changes

- 4e9f1b2: Add `boards` to `CHARACTER_ATTACH_COLUMNS` (worker auto-attach of identity boards), the `CHARACTER_PICKER_DISPLAY_ORDER` display constant + `characterBucketDisplayRank` / `sortCharacterEntriesForDisplay` helpers (boards-first picker menus), and an optional display-only `bucket` field on `ConnectedReference`.
- 254e7ef: Add a **ref-only** reference role that injects only the bare reference pointer — `reference image A` on image nodes, `@image_1` / `@video_1` / `@audio_1` on video nodes — with no `the {label} from …` phrase.

  - `roleToPhrase("ref-only", binding)` returns the bare binding; `ref-only` is now the first curated preset for `wired-character` / `wired-location`.
  - Plain image / video / audio references now **default** to ref-only (`DEFAULT_LABEL_BY_SOURCE` manual/wired-image → empty label). Character / location / object / animal asset defaults are unchanged.
  - Video/audio label-less body tokens resolve to the bare `@kind_N` (was `the subject in @kind_N`).

- 7ea3412: Variant + Role Separation for mention tokens: a non-mode 4th segment now parses as a per-mention **role** coexisting with the variant — `@kira:1:walking:clothes` attaches the walking image and injects "the clothes from …" (image and video resolvers; `@lib:1:weather/rain:lighting` for locations). Any role works, curated, custom, or `ref-only`. Every pre-existing token shape parses byte-identically; `CharacterMentionTokenInfo` gains an optional `role` field (mirroring the location parser's).
- da90853: Migrate to zod 4 (4.4.x). No API changes — schema exports and their parse
  behavior are unchanged. `@nodaro/shared` now declares `zod: ^4.4.0`;
  `@nodaro/prompts`'s bundled zod moves 3.25 → 4.4 and its schema-builder
  types use zod-4 generics (`z.ZodType<Output, Input>`).

### Patch Changes

- 269d1b6: Fix reference chips when an entity node feeds one generate node via both its identity handle and its plain `image` handle. New `sourceRefKey()` scopes an entity's image-handle ref to `${nodeId}::image` so the identity ref and the plain-image ref no longer collide on the node-id-keyed assembly maps (which previously dropped one non-deterministically — a literal `@name:N` token + lost character, or the image missing from the picker).

## 1.5.0

### Minor Changes

- 910fd2d: Relocate provider-rate derivation internals out of the published package (they now live server-side). Wire enums, ids, and credit-price tables are unchanged; if you imported the removed derivation helpers, fetch display costs from the API instead.

## 1.4.1

### Patch Changes

- 8661d4a: Registry restore after the license-split wipe: all pre-split packages were removed from npm (their Apache grants covered prompt craft that now lives in FSL-licensed `@nodaro/prompts`). npm permanently burns unpublished version numbers, so every package takes a patch bump. No code changes.

## 1.4.0

### Minor Changes

- cd33c25: License split: creative/prompt modules (person + picker catalogs with hints, identity-lock, entity prompt builders, brand presets, prompt/reference assembly) moved from Apache-licensed `@nodaro/shared` into the new **`@nodaro/prompts`** package (FSL-1.1-Apache-2.0 — free for any non-competing use, Apache after two years per version). `@nodaro/shared` keeps the structural public contract (types, wire enums, model catalog, new `entity-asset-types` vocabulary, hint-graph types). `@nodaro/sdk` now depends on `@nodaro/prompts` and keeps its full API — `buildPersonHints`, `buildPersonSeedPrompt`, and the `PEOPLE` catalog re-exports are unchanged for consumers. Shipped as minors while the packages have no external consumers (registry copies of prior versions are being replaced).

## 1.3.0

### Minor Changes

- 3879557: Add optional `logo.image` and `logo.imageBackdrop` fields to `BrandLogo`, letting a brand supply an uploaded logo image (an https URL on the Nodaro CDN) that renders in shot-sequence brand lockups, with an optional hex backdrop panel. Backward-compatible: text-only logos are unchanged.

## 1.2.1

### Patch Changes

- 37f1805: No functional changes. Republish so the npm provenance attestations reference the repository's current (post-history-rewrite) source commits — earlier versions' attested commit links point at rewritten-away SHAs.

## 1.2.0

### Minor Changes

- 6bcdb96: Add the platform's single-source video default: `DEFAULT_VIDEO_PROVIDER` (`seedance-2-fast`), `DEFAULT_VIDEO_DURATION_SEC` (4), and `applyDefaultVideoSelection()` — used by the generate-video/text-to-video routes, the DAG payload builder, and the KIE provider fallback. Previously the route default (`minimax`) and the DAG default (`kling`) disagreed; a nothing-specified request now resolves to `seedance-2-fast:4s:480p` (16 credits), guarded by tests in shared + billing.

## 1.1.0

### Minor Changes

- ca65d28: Add typed support for the new `assemble-narrated-video` node: `AssembleNarratedVideoParams` with typed `client.nodes.run`/`runAndWait` overloads in `@nodaro/sdk`, and the `assembleNarratedVideoCredits` credit estimator (`3 + ceil(blocks/6)`) exported from `@nodaro/shared`.
- c42a82f: Centralize community listing types in `@nodaro/shared` (single source of truth, re-exported by `@nodaro/sdk`), and add a `community` command group to `@nodaro/cli` (`browse`, `get`, `favorites`, `clone`, `favorite`, `report`) mirroring the SDK resource. Publishing remains admin/editor-only and is intentionally not exposed.
- 5585889: Admins can now share/unshare community listings via the SDK + CLI. `@nodaro/sdk`: `community.publish()`, `community.unpublish()`, `community.sharedListing()`. `@nodaro/cli`: `community publish/unpublish/shared-status`. (All require an admin token; publishing requires owning the source entity and, for characters, a likeness attestation.)
- 4260c1e: Add `resolveEffectiveSourceType` and `ENTITY_IMAGE_HANDLE_TYPES` — the single source of truth for treating an entity node's `image` source handle as a plain image producer (vs. its identity `*Ref` handle).
- 64d6d81: Add `imageReferenceLimit(provider)` — a per-image-model reference-image cap reader (the scalar image analogue of the video side's `videoReferenceLimits`). Returns `0` when a model accepts no reference images (so `> 0` doubles as a supports-references gate), else the per-model cap from `REF_IMAGE_MAX_LIMITS` (fallback `DEFAULT_REF_IMAGE_MAX`).

  The reader resolves text-to-image ids through their auto-routed i2i sibling (`T2I_TO_I2I_VARIANT`), matching the generate-image route's `resolveEffectiveProvider`, so the advertised count reflects what a user actually gets: `gpt-image-2` → 16, `seedream-5-lite` → 16, `grok`/`qwen` → 1, `nano-banana-pro`/`flux-2-max` → 8, `wan-2.7` → 9. Values mirror the existing product cap (`REF_IMAGE_MAX_LIMITS`), which is intentionally tighter than some raw provider schemas (e.g. `flux-2-pro` = 4) — no caps were changed. Lets the Studio Framing picker surface a real per-model "References" count instead of support-only.

- ddeb67a: Initial public release.

  - `@nodaro/shared` — types, model registries, prompt helpers, presentation utils, edge/range logic, identity-lock helpers shared across the Nodaro stack.
  - `@nodaro/sdk` — typed REST client for the Nodaro API. Three auth modes (StaticTokenAuth, supabaseAuth, CallbackAuth), 7 resources (workflows, projects, jobs, executions, nodes, developerApps, oauth), typed error hierarchy.

- acd2564: Add a facial-geometry layer to the structured Person catalog in `@nodaro/shared` and surface it through `@nodaro/sdk`.

  `@nodaro/shared`: new `PersonValue` fields + `PEOPLE` catalog options for a facial-geometry / feature-ratio control layer under the Face section — `cheekbones`, `facialFullness`, `eyelidType`, `canthalTilt`, `eyeSpacing`, `eyeSetBrow`, `noseTip`, and the split `lipFullness` + `lipShape` (the old combined `lips` is kept as a deprecated alias that still resolves). Each option contributes a precise prompt fragment via `buildPersonHints`; neutral options inject nothing. New export `migratePersonValue(value)` relocates legacy `eyeShape` / `lips` values onto the new fields. Backward compatible — option ids are stable, so existing data emits identical prompts.

  `@nodaro/sdk`: re-export `PersonValue`, `PEOPLE`, `PERSON_DIMENSION_ORDER`, `PERSON_DIMENSION_LABELS`, and `buildPersonHints`, plus a new `buildPersonSeedPrompt(value)` helper that collapses a `PersonValue` into the comma-joined seed-prompt fragment for `characters.generate({ seedPrompt })`.

- 7a38259: Add the brand-token authoring layer: `BrandTokens`/`BrandPalette`/`BrandFonts`/`BrandLogo` types, the 8-preset `BRAND_PRESETS` library (`BRAND_PRESET_IDS`, `BRAND_PRESET_META`), and `resolveBrandInput()`. Powers the video-director "brand layer" — motion-graphics videos render on-brand (palette + heading/body fonts) via an optional `brandTokens` on the shot-sequence brief/plan, with an LLM auto-select + `list_brand_presets` MCP tool.
- b3f214b: Add brand typography ramp tokens: `BrandCasing`, `BrandTypeSpec` ({weight, casing, tracking}), and `BrandFonts.headingType`/`bodyType`. The 8 brand presets now declare heading/body weight (and uppercase/tracking where intentional), completing the video-director brand layer's typography.
- fbcd7c8: Add picker-catalog discovery: `client.pickerCatalogs` (`list`/`get`) over the new public `/v1/picker-catalogs` endpoints, plus `summarizePickerCatalogs`/`projectPickerCatalog` helpers in `@nodaro/shared`.

### Patch Changes

- e0aec7e: Correct the license statement in the `@nodaro/shared` and `@nodaro/sdk` READMEs (the packages are Apache-2.0, not the repository-root Sustainable Use License) and add `repository`/`homepage`/`bugs` metadata to all three published package.json files so npm links back to the source monorepo.
