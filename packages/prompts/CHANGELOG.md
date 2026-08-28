# @nodaro/prompts

## 1.8.1

### Patch Changes

- f0d39b9: fix(catalogs): stop four prompt hints from injecting content outside their own dimension (same class as the earlier cowboy-shot holster).

  - `framing/composition/magazine-spread`: drop the fabricated typography ("bold display typography… headline and pull quotes integrated with the photograph") — a composition picker arranges the frame, it shouldn't invent headlines and quotes in a language the user never chose. The two-page layout + gutter remain.
  - `framing/composition/cutaway-cross-section`: reworded from a building-specific hint ("the building's near wall peeled away… the subject inhabiting one of the rooms") to a generic cross-section, so it no longer conjures a building for portrait/desert/space shots.
  - `lens/macro` vs `framing/shot-size/macro` were the same instruction twice. `lens/macro` now describes the OPTICS only (close focus, life-size magnification, shallow DOF); `framing/macro` keeps the magnification/framing. Picking both no longer duplicates.
  - `lens/anamorphic`: dropped the "cinematic widescreen feel" format claim (overlaps `camera-film/anamorphic-scope`'s 2.39:1); the lens hint now describes optics only (oval bokeh, horizontal flares).

- c089b33: fix(framing): drop the "holster visible" wardrobe clause from the `cowboy-shot` prompt hint (Shot Size must describe the frame only), and remove the `head-to-knees` entry — a duplicate crop of `medium-wide-shot` with no way for a user to tell them apart. `head-to-knees` is dropped from the framing catalog (`@nodaro/prompts`) and all 11 i18n locales (`@nodaro/shared`); `medium-wide-shot` stays as the canonical term.
- 5f67ce2: Published manifest now declares `@nodaro/shared` as a real semver range (`^2.11.0`) instead of the workspace wildcard `*`. With `*`, a consumer's lockfile kept whatever older `@nodaro/shared` it already had and `@nodaro/prompts` 1.8.0 failed at import time (`does not provide an export named registerCatalogSidecars`); npm now resolves the matching `@nodaro/shared` automatically. A repo guard (`tools/check-published-manifests.mjs`) runs in CI and in the pre-publish gate so no published package can regress to a wildcard.
- Updated dependencies [c089b33]
  - @nodaro/shared@2.12.1

## 1.8.0

### Minor Changes

- 18766f4: Person-pack curation is now enforced in the app UI, not only in `/v1/catalogs`.

  `@nodaro/prompts`: `getRegisteredPeople()` — read directly by the picker-ui person grids — becomes the composed funnel, folding the same `CatalogPack` registry `composePickerCatalogs` folds (deny/replace/extend on `catalogId:"person"`, in registration order). A deny/replace pack now hides base person entries in the picker grids, not just in the catalogs projection. A guard test pins the grid's person id-set equal to the composed catalog's forever.

  `@nodaro/shared`: two generic, content-free registration slots that `@nodaro/prompts` populates at pack-registration time (shared never imports prompts):

  - `setRegisteredPersonPackFields([...])` so `getParameterValue(data, "person")` resolves a pack dimension in the `{PersonLabel}` field-mapping fallback.
  - `registerCatalogSidecars(catalog, sidecars)` / `resetCatalogSidecars()` so a pack's localized sidecars resolve through `resolveLabel`/`resolveDescription`/`entryMatchesQuery` in the app UI.

  All three are inert on mainline (empty registries = byte-identical behavior). No deployment-specific content enters either package.

- ca8594e: Catalog replacement/extend pack seam. `@nodaro/prompts` gains a vendored catalog-pack registry (`registerCatalogPack` with `replace`/`extend`/`deny` modes) composed at the picker-catalog root — `getRegisteredPickerCatalogs()` is the single funnel every enumerating consumer reads (funnel getters, `projectAllCatalogs`, completeness). The base `PICKER_CATALOGS` is frozen and never mutated in place; curation is additive-by-registration. Also adds pack sidecar-coverage reporting (`computePackSidecarCoverage`) and a single-dim promptHint fallback so pack-added ids resolve.

  `@nodaro/shared` gains exactly one thing: the tag-free `ProjectedCatalog` / `ProjectedCatalogOption` / `ProjectedCatalogDimension` wire shape for `GET /v1/catalogs`. No tags, no policy field — the deferred `CatalogPolicy` never crosses the Apache boundary.

- 1096ad2: Compact professional `term` on every picker-catalog entry.

  `@nodaro/prompts`: each catalog entry can now carry a short `term` beside its long `promptHint` — the two-to-four word phrase a professional would actually write in a prompt ("whip pan left", "hard cut", "medium close-up"). `label` stays what users see, `promptHint` is what models read in verbose hint mode, `term` is what they read in compact hint mode. New `term.ts` (`deriveTerm` / `isSuspiciousDerivedTerm` / `resolveTerm` / `TERM_MAX_CHARS`) plus a `get<Name>Term(id)` getter alongside every `get<Name>PromptHint(id)`, and roughly 1,370 explicit terms authored where the lowercased label is not the trade term. A guard test walks every registered catalog and fails for a suspicious label with no authored term, for a term over the length or word cap, and for two ids in one catalog that would inject the same fragment — so the convention is enforced rather than documented. `PickerOption.term` is always present and already resolved (`""` for a no-op "auto"/"none" entry that injects nothing) — including on options added by a catalog pack, which are resolved at composition so a pack built against an older `@nodaro/prompts` still injects in compact mode. Consumers render `label` and inject `term`, never deriving one from the other.

  Where a catalog's grammar carries its meaning, the term keeps that grammar rather than leaving a consumer to re-add it: Material terms read `"made of polished gold"` (not `"polished gold"`, which would only name a material present in the scene) and Held Prop terms keep the held-in-hand verb (`"cradling a cat"`). Mood terms name the subject's expression, matching the register of their hints.

  Selecting a register: `PickerHintMode` (`"full" | "compact"`) is exported from `term.ts`, the `build*Hints` family (`buildFramingHints`, `buildPersonHints`, `buildStylingHints`, `buildLightingHints`, …) takes an optional trailing `mode: PickerHintMode = "full"` so existing calls are unchanged, and `getParameterPromptHint` reads `data.hintMode` off the node — absent or unrecognized means `"full"`. A compact Camera Motion / Transition node propagates the mode into the pickers wired to its `startState` / `endState` handles; a wired picker that declares its own `hintMode` wins over what it inherits.

  Pack authors are NOT required to supply it: `registerCatalogPack` accepts term-less options/dimensions/catalogs (`PickerOptionInput` / `PickerDimensionInput` / `PickerCatalogInput`) and resolves `term` at composition, so an existing vendored pack keeps compiling.

  `@nodaro/shared`: `ProjectedCatalogOption` gains `term?: string` — the `GET /v1/catalogs` wire shape carries it at **both** detail levels, so a thin client rendering its own pickers gets the injectable term without a second `detail=full` fetch. The four object-entity catalogs (animals / vehicles / weapons / furniture) gain the same optional `term?` field, authored only where the label is a UI compound ("Airship / Dirigible" → `airship`, "Plasma Sword / Lightsaber" → `plasma sword`); everywhere else the label _is_ the professional term and `@nodaro/prompts` derives it the same way it derives every other catalog's (lowercased, parentheticals stripped).

  `@nodaro/sdk`: `PickerOption` and `ProjectedCatalogOption` mirror the new field, so `client.pickerCatalogs.get()` and `client.catalogs.list()` are typed for it at both detail levels.

  `@nodaro/cli`: `nodaro catalog` snapshots now record an entry's `term`, and `diff-upstream`'s three-way merge counts a term-only upstream edit as a real content change — previously an upstream entry whose only edit was its `term` never reached a vendored pack's merge plan. That behaviour change is what makes this a minor rather than a patch. `nodaro pickers get` also documents `term` on its default (compact) detail level.

### Patch Changes

- d7c78e5: `DEFAULT_IDENTITY_LOCK` changes from `"soft"` to `"off"` — characters now default to no identity lock (users opt in to soft/strict for facial-likeness preservation).

  This is the single source of truth the app reads for every unset identity-lock fallback (canvas node, config panel, Character Studio display; backend create defaults and asset generation), so a Character node/entity with no explicit `identityLock` now emits no lock line. Consumers that pass an explicit `"off"/"soft"/"strict"` are unaffected.

- 584d953: New `IMAGE_REFERENCE_PROMPT_DOCTRINE` — the `{image:N:label}` reference-token idiom for image generation (token grammar, connection-order numbering, composition patterns), rendered into the generate-image node skill by gen-skills the same way the per-provider video doctrines are.
- d0b73c6: getRegisteredPeople() returns the base PEOPLE reference itself when no person packs are registered (mainline identity on the empty path, matching the sibling getters), instead of an unconditional copy.
- 1aacfca: Add a content-free contract guard test: the package source must not read
  `process.env`. Deployment-gated prompt content (fixed clauses, forced vocal
  gender) belongs in a deployment's registered `PromptPolicy`, never in this
  published package.
- 646062e: The provider image-reference cap now slices connected references by attach priority (canonicals, manual and extra refs before unmentioned variants) instead of raw list order, so a variant-rich character can no longer evict a character wired after it.
- Updated dependencies [18766f4]
- Updated dependencies [ca8594e]
- Updated dependencies [5947e21]
- Updated dependencies [83c38a7]
- Updated dependencies [1096ad2]
  - @nodaro/shared@2.11.0

## 1.7.3

### Patch Changes

- 1606089: Editorial cleanup of a doctrine section header.
- ff52285: Comment tidy-up in the featured-entity catalog and style presets.
- Updated dependencies [ff52285]
- Updated dependencies [d964b4d]
- Updated dependencies [d1ad395]
- Updated dependencies [c7fde04]
- Updated dependencies [4282945]
- Updated dependencies [776e7f5]
- Updated dependencies [b49a7ff]
- Updated dependencies [6b8cfab]
- Updated dependencies [3488681]
- Updated dependencies [823b629]
- Updated dependencies [9df6f33]
  - @nodaro/shared@2.9.0

## 1.7.2

### Patch Changes

- 034ac61: **@nodaro/shared**

  - New Grok Imagine Image 2.0 model ids in `MODEL_CATALOG` and the provider enums: `grok-2` (t2i, in `IMAGE_GEN_PROVIDERS`), `grok-2-edit` and `grok-2-segment` (in `IMAGE_EDIT_PROVIDERS`). The edit and segment ops reference a prior grok-2 generation's KIE task id (the generation job's `kieTaskId` output) instead of an image URL; `grok-2-edit` optionally takes 1-based segment `maskIndexes` for region-targeted edits, and `grok-2-segment` is free.
  - New export `TASK_CHAINED_EDIT_PROVIDERS` — the set of edit providers that take a prior Grok task id instead of an image URL (`grok-upscale`, `grok-2-edit`, `grok-2-segment`); single source of truth for the route/worker/MCP taskId-vs-imageUrl branching.

  **@nodaro/prompts**

  - Prompt-wizard image capabilities gain a `grok-2` entry.

- Updated dependencies [01a9716]
- Updated dependencies [034ac61]
  - @nodaro/shared@2.7.0

## 1.7.1

### Patch Changes

- d36034c: **@nodaro/shared**

  - Seedance 2.5 (`seedance-2-5`) gains the **1080p** resolution tier (KIE "Seedance 2.5 now supports 1080P", probe-verified 2026-08-17 — 4k/2k/1440p are still rejected). `MODEL_CATALOG` `resolutions` is now `["480p", "720p", "1080p"]`, catalog pricing rows carry the 8s/30s 1080p anchors (2280/8550 no-ref, 1370 with-ref at 8s), and the `QUALITY_MAP` `high` rung maps to `1080p` (was `720p`). Everything derived from the catalog — credit identifier clamping, `/v1/nodes` `providerResolutions`, GVP/EVP tier clamps, resolution dropdowns — picks the new tier up automatically.

  **@nodaro/prompts**

  - Seedance 2.5 doctrine and wizard capability strings updated for the 1080p tier (routing advice now sends only 4K jobs to `seedance-2`).

- Updated dependencies [8221886]
- Updated dependencies [3792fbb]
- Updated dependencies [d36034c]
  - @nodaro/shared@2.6.0

## 1.7.0

### Minor Changes

- 8c09cd5: Provider prompt doctrine covers the full video roster: six new sourced+dated
  family entries — VEO 3.1 (Google's official five-part formula, dialogue/SFX
  syntax, timestamp multi-shot), Gemini Omni, Grok Imagine (incl. video-1.5),
  Wan 2.x (Alibaba's official formulas + anti-patterns), HappyHorse 1.1, and
  Runway-via-KIE. Kling doctrine now also covers the silent kling-turbo /
  kling-master tiers (with a variant note). The Seedance doctrine gains the
  auto-path six-step formula (subject→action→environment→camera→style→
  constraints, 60-100 words, camera/subject motion separation) and the
  magenta-line camera-path method for the manual pro path. bytedance-lite/pro
  and hailuo-2.3 stay deliberately uncovered (different engines — mapping the
  family doctrine would overclaim; pinned by test).
- 2554aea: Add `picker-wiring.ts` — the parameter-picker wiring vocabulary as data:
  `SINGLE_PICKER_WIRING` / `MULTI_PICKER_WIRING` / `getPickerWiring` with each
  picker node type's value field(s), default, catalog id, entries, grouping, and
  per-field option lists (`fieldOptions`) for multi-dim pickers. Extracted from
  the app's parameter-picker registry so the app's community fallback, the
  first-party rich picker package, and Nodaro Cine all share one definition.
  Renderers are deliberately excluded — this is vocabulary, not presentation.
- a066015: Extend `PICKER_ANALYZER_REGISTRY` from 5 to all 38 picker catalogs — 25 new
  flat descriptors (setting, atmosphere, style, mood, color-look, photographer,
  aesthetic, era, photo-genre, backdrop, render-quality, composition-effects,
  post-process-effects, action-fx, loop-subject, transition, character-fx, pose,
  material, held-prop, camera-motion, animal, vehicle, weapon, furniture) and 8
  new discriminated ones (lighting, temporal, exposure-settings, music-genre,
  music-mood, instrumentation, voice-character, voice-delivery; the sound/voice
  pickers synthesize entries across their per-field catalogs with an explicit
  dimension tag). Adds `PICKER_ANALYZER_FAMILIES` — the 6-family partition
  (scene/look/camera/character/elements/audio) the text-to-picker route uses to
  batch analysis calls (a single all-38 legend measures ~53k tokens).

### Patch Changes

- Updated dependencies [34b3b31]
  - @nodaro/shared@2.2.1

## 1.6.0

### Minor Changes

- 7162e62: Add MiniMax Hailuo 3 (`minimax-h3`) — a Seedance-2-class multimodal video model.

  `@nodaro/shared`: `minimax-h3` joins the model catalog and every video provider registry (t2v + i2v arrays, reference limits 9 images / 3 videos / 3 audio, always-on `audio_driven` capability, adaptive default aspect, per-second duration tiers 4–15s, the reference-audio lip-sync surface, and the 7000-char prompt cap). New exports: `MINIMAX_H3_PROVIDERS`, `isMinimaxH3Provider`, and `PRICING_DEFAULT_DURATION_SEC` (prices a duration-less request at the model's own default duration — 6s for minimax-h3 — instead of the global 5s fallback, which `buildVideoCreditModelIdentifier` now consults). The model has a FIXED 2K output: no `resolutions` entry, and its credit identifier is duration-only (`minimax-h3:8s`) with no resolution or `-ref` dimension.

  `@nodaro/prompts`: new provider prompt doctrine for `minimax-h3` (modes, ordinal reference conventions, always-on audio, per-second pricing guidance) and prompt-wizard capability lines for text-to-video and image-to-video. The existing `resolveSeedance2Inputs` resolver is reused by the new provider unchanged — same caps, same frames-fold-into-references semantics.

- 49f1aa4: Add `seedance-2-5` (Seedance 2.5) as a video model alongside the Seedance 2.0 family — text-to-video, image-to-video, first+last frame, multimodal references, and the reference-audio lip-sync surface.

  It joins `SEEDANCE_2_PROVIDERS`, so it inherits the family's capability gating (adaptive aspect, the shared input resolver, per-second `resolution × video-ref` pricing) and derives into `GVP_SUPPORTED_PROVIDERS` / `GVP_EXTEND_PROVIDERS` / `GVP_END_FRAME_PROVIDERS` and the Edit Video Pro subset automatically.

  Where 2.5 differs from the 2.0 SKUs, the difference is carried by per-provider data rather than by branching on the family set:

  - **4–30s** in a single generation (2.0 caps at 15s), with one seeded price tier per second so no duration rounds up to a coarser rung.
  - **480p / 720p only** — no 1080p or 4K tier.
  - Reference caps of **30 images / 10 videos / 10 audio** (`SEEDANCE_2_5_REF_LIMITS`) vs the family's 9/3/3, and reference audio up to 30s per clip.
  - Prompt limit of 30000 chars, which raises `PROMPT_HARD_CEILING` from 20000 to 30000 so the route can't reject a prompt the model accepts.

  The resolution ceiling and duration ceiling were established by a live capability probe against KIE, not from the published schema: `1080p`/`4k`/`2k` are rejected identically to a nonsense value, and 31s+ is rejected, so ByteDance's native 4K and 180s ultra-long modes are not reachable through the KIE proxy.

  Two new mechanisms ship with it, both additive:

  - `PRICING_DEFAULT_RESOLUTION` — the resolution twin of `PRICING_DEFAULT_DURATION_SEC`. When a request omits `resolution`, the credit identifier now prices the model's real provider-side default instead of falling back to the cheapest tier. Only `seedance-2-5` is registered, so no existing model is repriced.
  - `FRAME_MODE_ADAPTIVE_ONLY_ASPECT` — models that accept only `adaptive` aspect once a start frame is wired. Seedance 2.5 hard-rejects any explicit ratio in frame mode (undocumented; probe-verified), so the payload builder coerces it. Lossless: with a start frame, `adaptive` is that frame's own aspect.

- 0cd2a29: Suno V5_5 custom duration + replace-section field additions.

  `@nodaro/prompts`: `AssembleSunoResult` gains an optional `duration` (seconds), passed through verbatim from `data.duration` — the provider client is the single send-gate (KIE honors it only when `customMode` is true and the model is `V5_5`), so the assembler stays a faithful field carrier for the FE run, the orchestrator, and the editor preview alike.

  `@nodaro/shared`: `NODE_MAPPABLE_FIELDS["suno-replace-section"]` gains `fullLyrics` (the complete post-edit lyric sheet the current KIE spec lists as required) and `negativeTags`, so both fields can be wired from upstream text producers.

### Patch Changes

- d086c0f: MiniMax Hailuo 3 (`minimax-h3`) gains KIE's new resolution lever: `768P | 2K` (default 2K) on all three endpoints (text/image/reference-to-video).

  `@nodaro/shared`: the catalog entry declares `resolutions: ["2K", "768P"]` (first entry = UI default; uppercase = the exact KIE wire enum) and its `VIDEO_VARIABLE_PRICING` axis becomes `duration+resolution`. New exports: `MINIMAX_H3_DEFAULT_RESOLUTION` and `normalizeMinimaxH3Resolution` — the single collapse rule shared by billing and provider forwarding (only a case-insensitive `768p` selects the cheaper tier; anything else renders AND bills as 2K, matching KIE's omitted-param behavior). `buildVideoCreditModelIdentifier` appends `:768p` for a verified 768P selection; bare duration composites stay the 2K rate, byte-identical to the pre-lever identifiers, so existing workflows and admin price overrides keep their ids. KIE rates: 36.5 cr/s @2K (unchanged), 22.5 cr/s @768P; reference-video input seconds bill at the selected tier's rate.

  `@nodaro/prompts`: doctrine tip and prompt-wizard capability lines updated from "fixed 2K" to the two-tier output.

- Updated dependencies [fae3b40]
- Updated dependencies [3a71fc5]
- Updated dependencies [89ea2c0]
- Updated dependencies [e264214]
- Updated dependencies [d086c0f]
- Updated dependencies [7162e62]
- Updated dependencies [49f1aa4]
- Updated dependencies [0cd2a29]
- Updated dependencies [5d66f2a]
- Updated dependencies [18d9cde]
- Updated dependencies [c19c3ad]
- Updated dependencies [270545c]
  - @nodaro/shared@2.2.0

## 1.5.0

### Minor Changes

- 72858e1: New "Face Privacy" factory-preset group for generate-image (gpt-image-2, auto aspect): Faceless · 3D Blank Head, Remove Faces, and Transparent Faces — one-click `{image:1}` edits that anonymize people while keeping the rest of the photo untouched.

### Patch Changes

- Updated dependencies [ee8061e]
  - @nodaro/shared@1.16.0

## 1.4.0

### Minor Changes

- 89bee09: `resolveSeedance2Inputs` accepts an optional `prompt` and suppresses the trailing "Use @image_N as the opening (first) frame" sentence when the prompt already binds a first frame itself (new `promptBindsFirstFrame` export). Field finding: the first-frame directive only reliably steers Seedance when adjacent to the extend colon; a duplicate sentence at the end dilutes it. The frame image still rides the reference list.

### Patch Changes

- Updated dependencies [606997d]
- Updated dependencies [2f32c1b]
- Updated dependencies [0dedf9b]
- Updated dependencies [774a2d1]
  - @nodaro/shared@1.14.0

## 1.3.1

### Patch Changes

- 2087527: Content-rejection hardening from the first app_reports batch: the `feature-midriff-visible` / `feature-navel-visible` prompt hints move to garment language (no "bare stomach" anatomy emphasis), `buildPersonHints` folds the pair into ONE neutral clause when both are picked, and `buildStylingHints` skips `makeup-bold-lips` when the shared value map already carries the person catalog's `lip-state-bold-red` (single-map consumers were doubling the lipstick clause). SDK: `GenerateCharacterInput` and `GenerateAssetInput` gain optional `origin` — client-app attribution for the platform's diagnostic reports.

## 1.3.0

### Minor Changes

- c7d3d25: Seven new styling catalog items closing out the first `/admin/picker-gaps` report batch: `outfit-sundress` (halter sundress / patterned maxi), `outfit-soccer-jersey` (national-team jersey with crest), `outfit-pharaoh` (ancient-Egyptian regalia — usekh collar, pectoral, shendyt kilt), `headwear-nemes` (striped pharaonic nemes with uraeus), `face-paint-flag` (national flag on cheeks, sports-fan), and `state-halter-neck` / `state-plunging-neck` (wardrobe-state neckline coverage). `@nodaro/shared` carries the matching label+description translations for all 11 locales. Items only — analyzer legends, prompt hints, and picker UIs derive from the catalog with no structural change.

### Patch Changes

- Updated dependencies [c7d3d25]
  - @nodaro/shared@1.13.1

## 1.2.1

### Patch Changes

- 02cc802: `getParameterPromptHint` gains a `style-guide` case (returns the node's `text`), so `{Style Guide}` refs resolve at execution time and prompt-handle wires inject the style text instead of leaving literal `{Style Guide}` in the outgoing prompt. New `HINT_EXEMPT_PARAMETER_TYPES` export in `@nodaro/shared` — the canonical set of parameter types that intentionally produce no prompt hint (`motion`, `scene-count`, `duration`, `aspect-ratio`); consumers that treat parameter nodes as text producers (e.g. `{Label}` auto-fill sets) should derive from `PARAMETER_NODE_TYPES` minus this set.
- Updated dependencies [dca72ad]
- Updated dependencies [02cc802]
  - @nodaro/shared@1.13.0

## 1.2.0

### Minor Changes

- 9993861: Kling native dialogue: `VIDEO_AUDIO_CAPABILITY` upgrades `kling` (2.6) and `kling-3.0` from `ambient` to `native_speech` (probe-verified on the KIE path: scripted quoted dialogue is spoken verbatim with lip sync behind the `sound` toggle) and adds a `kling-3-omni` entry (`native_speech`, `generateAudio` lever). New optional `VideoAudioCapability.defaultOn` flag mirrors each model's own audio default; `buildVideoCreditModelIdentifier` now falls back to it when `sound` is omitted, so intent-less kling-3.0 requests bill the `:audio` tier their generation actually produces (pass `sound: false` for the silent tier). `@nodaro/prompts` gains a Kling 2.6/3.0/Omni audio-prompting doctrine (dialogue labeling, voice/tone control, Audio block, element refs, limits).

### Patch Changes

- Updated dependencies [9993861]
  - @nodaro/shared@1.11.0

## 1.1.1

### Patch Changes

- aac8660: HappyHorse 1.1: the `happyhorse` / `happyhorse-i2v` / `happyhorse-ref2v` ids now target KIE's `happyhorse-1-1/*` endpoints (1.0 was delisted; identical parameter surface, so existing workflows keep working). Catalog gains the model's full 9-ratio aspect set (adds `4:5`, `5:4`, `21:9`, `9:21` for T2V/Ref2V) and per-second pricing tiers (`<id>:<N>s:<720p|1080p>`, N = 3–15) in `DURATION_PRICED_PROVIDERS` / `VIDEO_DURATION_TIERS` / `RESOLUTION_DURATION_PRICING`. Prompt-wizard capability blurbs updated accordingly.
- Updated dependencies [aac8660]
  - @nodaro/shared@1.7.0

## 1.1.0

### Minor Changes

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

- Updated dependencies [4e9f1b2]
- Updated dependencies [254e7ef]
- Updated dependencies [269d1b6]
- Updated dependencies [7ea3412]
- Updated dependencies [da90853]
  - @nodaro/shared@1.6.0

## 1.0.1

### Patch Changes

- 8661d4a: Registry restore after the license-split wipe: all pre-split packages were removed from npm (their Apache grants covered prompt craft that now lives in FSL-licensed `@nodaro/prompts`). npm permanently burns unpublished version numbers, so every package takes a patch bump. No code changes.
- Updated dependencies [8661d4a]
  - @nodaro/shared@1.4.1
