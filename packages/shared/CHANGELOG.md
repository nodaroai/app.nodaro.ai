# @nodaro/shared

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
