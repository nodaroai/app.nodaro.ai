# @nodaro/cli

## 1.14.0

### Minor Changes

- 0ac4f4c: Image collage storyboard badges can be placed in either top corner — default is now **top-left**.

  `@nodaro/sdk`: `media.imageCollage(input)` accepts `badgePosition?: "top-left" | "top-right"`. The number/label badges default to the image's top-left corner (the storyboard convention — the shot number leads the frame in reading order); `"top-right"` keeps them clear of a subject composed left-of-centre. Existing callers that relied on the previous top-right placement should pass `badgePosition: "top-right"` explicitly.

  `@nodaro/cli`: `nodaro media collage` gains `--badge-position <top-left|top-right>` (default `top-left`); any other value is a hard error.

### Patch Changes

- Updated dependencies [0ac4f4c]
  - @nodaro/sdk@1.22.0

## 1.13.0

### Minor Changes

- 06805b8: Image collage gains storyboard badges — optional per-image sequence numbers and captions.

  `@nodaro/sdk`: `media.imageCollage(input)` accepts two new optional fields. `numbered` (boolean) stamps a 1-based sequence badge at each image's top-right, in `imageUrls` order — storyboard mode. `imageLabels` (`Array<string | null>`, index-aligned with `imageUrls`; `null`/`""`/omitted = no caption for that image) captions images after the number, rendered as `3 · Close-up`. Both are optional and default off; badges are an overlay only and never change the layout, the output size, or the credit cost.

  `@nodaro/cli`: `nodaro media collage` gains `--numbered` (stamp the sequence badges) and a repeatable `--label <text>` flag, index-aligned with the image arguments in order (pass `""` to skip one image). More `--label` values than images, or any label over 80 characters, is a hard error.

### Patch Changes

- Updated dependencies [06805b8]
- Updated dependencies [ded5ac2]
- Updated dependencies [8802a1e]
  - @nodaro/sdk@1.21.0
  - @nodaro/shared@2.12.2

## 1.12.0

### Minor Changes

- ca8594e: Add `nodaro catalog` — offline vendored-pack maintenance (snapshot, diff-upstream three-way merge, sidecar validate).
- 5569422: Workflow sharing reaches the SDK and CLI.

  `@nodaro/sdk`: `client.workflows` gains `setVisibility(id, visibility)`, `move(id, { projectId })`, `sharedWithMe()`, and a nested `collaborators` resource — `list` / `add` / `update` / `remove` over `/v1/workflows/:id/collaborators`. The active workspace already travels on every request (`withWorkspace()`), so `list` / `get` / `run` follow it unchanged. No new `@nodaro/shared` types — `WorkflowVisibility` and `CollaboratorRole` were already exported.

  `@nodaro/cli`: `nodaro workflows share`, `move`, `shared-with-me`, and a `collaborators` subcommand group (`list` / `add` / `update` / `remove`). The global `--workspace <id>` flag already scopes `list` / `create` / `run`. A collaborator is added by user id or by any email address.

- 1096ad2: Compact professional `term` on every picker-catalog entry.

  `@nodaro/prompts`: each catalog entry can now carry a short `term` beside its long `promptHint` — the two-to-four word phrase a professional would actually write in a prompt ("whip pan left", "hard cut", "medium close-up"). `label` stays what users see, `promptHint` is what models read in verbose hint mode, `term` is what they read in compact hint mode. New `term.ts` (`deriveTerm` / `isSuspiciousDerivedTerm` / `resolveTerm` / `TERM_MAX_CHARS`) plus a `get<Name>Term(id)` getter alongside every `get<Name>PromptHint(id)`, and roughly 1,370 explicit terms authored where the lowercased label is not the trade term. A guard test walks every registered catalog and fails for a suspicious label with no authored term, for a term over the length or word cap, and for two ids in one catalog that would inject the same fragment — so the convention is enforced rather than documented. `PickerOption.term` is always present and already resolved (`""` for a no-op "auto"/"none" entry that injects nothing) — including on options added by a catalog pack, which are resolved at composition so a pack built against an older `@nodaro/prompts` still injects in compact mode. Consumers render `label` and inject `term`, never deriving one from the other.

  Where a catalog's grammar carries its meaning, the term keeps that grammar rather than leaving a consumer to re-add it: Material terms read `"made of polished gold"` (not `"polished gold"`, which would only name a material present in the scene) and Held Prop terms keep the held-in-hand verb (`"cradling a cat"`). Mood terms name the subject's expression, matching the register of their hints.

  Selecting a register: `PickerHintMode` (`"full" | "compact"`) is exported from `term.ts`, the `build*Hints` family (`buildFramingHints`, `buildPersonHints`, `buildStylingHints`, `buildLightingHints`, …) takes an optional trailing `mode: PickerHintMode = "full"` so existing calls are unchanged, and `getParameterPromptHint` reads `data.hintMode` off the node — absent or unrecognized means `"full"`. A compact Camera Motion / Transition node propagates the mode into the pickers wired to its `startState` / `endState` handles; a wired picker that declares its own `hintMode` wins over what it inherits.

  Pack authors are NOT required to supply it: `registerCatalogPack` accepts term-less options/dimensions/catalogs (`PickerOptionInput` / `PickerDimensionInput` / `PickerCatalogInput`) and resolves `term` at composition, so an existing vendored pack keeps compiling.

  `@nodaro/shared`: `ProjectedCatalogOption` gains `term?: string` — the `GET /v1/catalogs` wire shape carries it at **both** detail levels, so a thin client rendering its own pickers gets the injectable term without a second `detail=full` fetch. The four object-entity catalogs (animals / vehicles / weapons / furniture) gain the same optional `term?` field, authored only where the label is a UI compound ("Airship / Dirigible" → `airship`, "Plasma Sword / Lightsaber" → `plasma sword`); everywhere else the label _is_ the professional term and `@nodaro/prompts` derives it the same way it derives every other catalog's (lowercased, parentheticals stripped).

  `@nodaro/sdk`: `PickerOption` and `ProjectedCatalogOption` mirror the new field, so `client.pickerCatalogs.get()` and `client.catalogs.list()` are typed for it at both detail levels.

  `@nodaro/cli`: `nodaro catalog` snapshots now record an entry's `term`, and `diff-upstream`'s three-way merge counts a term-only upstream edit as a real content change — previously an upstream entry whose only edit was its `term` never reached a vendored pack's merge plan. That behaviour change is what makes this a minor rather than a patch. `nodaro pickers get` also documents `term` on its default (compact) detail level.

### Patch Changes

- Updated dependencies [18766f4]
- Updated dependencies [ca8594e]
- Updated dependencies [ca8594e]
- Updated dependencies [d7c78e5]
- Updated dependencies [5947e21]
- Updated dependencies [74d5f37]
- Updated dependencies [83c38a7]
- Updated dependencies [584d953]
- Updated dependencies [5569422]
- Updated dependencies [d0b73c6]
- Updated dependencies [1096ad2]
- Updated dependencies [1aacfca]
- Updated dependencies [646062e]
  - @nodaro/shared@2.11.0
  - @nodaro/prompts@1.8.0
  - @nodaro/sdk@1.20.0

## 1.11.0

### Minor Changes

- cdef4ed: `nodaro org` and `nodaro workspace`: organizations, members, invitations, join codes and the audit log from a terminal — and, the part that matters, a way to say which workspace a command acts in.

  Three ways to say it, each beating the one below: `--workspace <id>` for one command, `NODARO_WORKSPACE` for a shell or a CI job, and `nodaro workspace use <id>` saved on the profile. `nodaro workspace current` reports which of the three decided, because an inherited environment variable otherwise looks exactly like a saved selection.

  `nodaro org invite` prints one line per address and shows the invitation LINK for every address that could not be emailed — an install with no mail provider delivers nothing, and an invitation nobody can reach is worse than none.

### Patch Changes

- Updated dependencies [8c4110e]
- Updated dependencies [0134594]
- Updated dependencies [cdef4ed]
- Updated dependencies [62bb3dd]
- Updated dependencies [f14fa42]
  - @nodaro/shared@2.10.0
  - @nodaro/sdk@1.19.0

## 1.10.0

### Minor Changes

- b49a7ff: Slideshow: `client.media.slideshow({ imageUrls, audioUrl?, imageDurations?, ... })` and `nodaro media slideshow` — 2–100 images + one optional audio track → MP4 via `POST /v1/slideshow`, locally rendered (FFmpeg), zero credits. Audio-anchored timing (equal split / pinned rows with disclosed proportional scaling); silent output without audio. Shared adds `PICKER_TO_COMBINE_TRANSITION` + `resolveSlideshowTransition` (transition-picker → xfade vocabulary mapping).
- b49a7ff: Still to Video: `client.media.stillToVideo({ imageUrl, audioUrl, motion?, intensity?, resolution?, aspectRatio?, fps?, fit?, padColor? })` and `nodaro media still-to-video` — one still image + one audio track → MP4 via `POST /v1/still-to-video`, locally rendered (FFmpeg), zero credits. The output duration is the audio's duration (no duration field); optional motion presets (zoom / pan / ken-burns) with intensity 1–10.

### Patch Changes

- Updated dependencies [1606089]
- Updated dependencies [ff52285]
- Updated dependencies [d964b4d]
- Updated dependencies [d1ad395]
- Updated dependencies [c7fde04]
- Updated dependencies [4282945]
- Updated dependencies [8f8099c]
- Updated dependencies [776e7f5]
- Updated dependencies [b49a7ff]
- Updated dependencies [b49a7ff]
- Updated dependencies [6b8cfab]
- Updated dependencies [3488681]
- Updated dependencies [823b629]
- Updated dependencies [9df6f33]
  - @nodaro/prompts@1.7.3
  - @nodaro/shared@2.9.0
  - @nodaro/sdk@1.18.0

## 1.9.0

### Minor Changes

- 6fe2aae: Surface-parity catch-up — four new command groups/subcommands:

  - `nodaro models list` — browse the model catalog: capability sheets, per-variant credit tiers, featured ★ and the `doctrineCovered` ✓ flag, filterable by `--kind` / `--mode` / `--family` / `--featured`.
  - `nodaro shots` — Cine share → remix records: `get` / `create` / `update` (visibility toggle) / `delete`.
  - `nodaro recast` — the authored-script lane (`skill` / `validate` / `import --rights-attested`) plus headless run control (`estimate` / `create` / `start` / `status`). Cloud edition only.
  - `nodaro pickers analyze "<text>"` — AI Fill: choose picker values from a free-text description (credit-billed).

### Patch Changes

- f86c20f: **@nodaro/sdk**

  - `ModelSummary.pricing` is now optional — `GET /v1/models` (and the MCP `list_models` twin) omit per-variant credit pricing on editions without a credit system (community/business), the same principle `/v1/nodes` applies to `creditCost`. JSDoc on `NodeDescriptor.creditCost` and on `workflows.delete()` / `developerApps.delete()` now states the edition behavior and the `NotFoundError` thrown when the id doesn't exist or isn't yours.

  **@nodaro/cli**

  - `nodaro models list` renders `-` in the credits column for models served without pricing (creditless editions) instead of crashing on the missing field.

- Updated dependencies [8221886]
- Updated dependencies [f86c20f]
- Updated dependencies [3792fbb]
- Updated dependencies [d36034c]
- Updated dependencies [6fe2aae]
  - @nodaro/shared@2.6.0
  - @nodaro/sdk@1.17.0
  - @nodaro/prompts@1.7.1

## 1.8.1

### Patch Changes

- Updated dependencies [c6487c9]
- Updated dependencies [fec478a]
  - @nodaro/shared@2.0.0
  - @nodaro/sdk@1.13.1

## 1.8.0

### Minor Changes

- 6cf8fc5: Identify the calling client to the backend, so job origin is recordable.

  Both packages now send an `X-Nodaro-Client` header — `sdk/<version>` and
  `cli/<version>` respectively — which the backend stores as the job's origin.
  Until now an operator looking at a job could not tell a CLI run from an SDK
  integration from a raw REST call: all three looked identical on the server.

  `createClient` gains a `clientLabel` option for anyone building another wrapper
  around the SDK; the CLI uses it to avoid reporting itself as plain SDK traffic.
  Both versions are injected at build time from `package.json`, so the reported
  version cannot drift from the released one.

  The header is sent only where it adds information: in a browser the `Origin`
  header already identifies the app and the backend prefers it, so the default
  label is suppressed there. That also avoids making browser apps depend on the
  header being present in the server's CORS `Access-Control-Allow-Headers` — a
  lagging or self-hosted backend would otherwise fail the preflight and break
  every call from the page.

  No behaviour changes for existing callers, and older versions keep working —
  they are simply recorded as generic API calls.

### Patch Changes

- Updated dependencies [6cf8fc5]
- Updated dependencies [46e2def]
- Updated dependencies [320ea3c]
- Updated dependencies [320ea3c]
  - @nodaro/sdk@1.12.0
  - @nodaro/shared@1.24.0

## 1.7.0

### Minor Changes

- cb52000: Expose LLM Advanced mode on every programmatic surface, and single-source the
  route defaults it seeds from.

  Advanced mode pins an LLM call to the vendor's own API — the only lane where
  `temperature`, `maxTokens` and the full reasoning-effort range actually take
  effect — and bills one credit tier up. It shipped on the canvas and the REST
  routes, but the SDK, CLI and MCP tools had no way to send it, so anything built
  on top of Nodaro was stuck on the aggregator lane with no signal that the
  sampling knobs it was passing were being ignored.

  - `@nodaro/shared` — new `LLM_ROUTE_DEFAULTS` / `llmRouteDefaults(feature)`: the
    per-feature `temperature` / `maxTokens` / `structuredOutput` each LLM route
    runs with. Previously these lived as literals inside ten separate routes while
    the config panel displayed a hardcoded 0.7/2048, so a node showed one number
    and ran another — and a single arrow-key press committed the wrong one.
  - `@nodaro/sdk` — `promptHelper.*` accepts `advancedMode` / `temperature` /
    `maxTokens`.
  - `@nodaro/cli` — `--advanced`, `--temperature`, `--max-tokens` on the prompt
    subcommands.

### Patch Changes

- Updated dependencies [cb52000]
- Updated dependencies [56d91a3]
  - @nodaro/shared@1.23.0
  - @nodaro/sdk@1.11.0

## 1.6.0

### Minor Changes

- ee974ef: New `nodaro media collage <imageUrls...>` command — composite 2–30 images into one 2K/4K collage via `POST /v1/image-collage`, including `--sizes` per-image relative size hints (0 auto / 1 big / 2 medium / 3 small, aligned by position; smart layout only), plus `--layout`, `--resolution`, `--aspect-ratio`, `--gap`, and `--background-color`.

### Patch Changes

- 731eced: Docs: correct the production `--base-url` example from `https://api.nodaro.ai` (a domain that does not exist) to `https://app.nodaro.ai`. The wrong example has misled users into configuring MCP connectors and CLI profiles against an unresolvable host.
- Updated dependencies [1b9b784]
- Updated dependencies [72858e1]
- Updated dependencies [ee8061e]
  - @nodaro/sdk@1.9.0
  - @nodaro/prompts@1.5.0
  - @nodaro/shared@1.16.0

## 1.5.0

### Minor Changes

- 7370b4d: Generate Video Pro run control — `client.videoPro.stop(jobId)` (graceful stop: keep + deliver the completed segments as the final video, refund the untouched remainder; the in-flight segment is billed) and `client.videoPro.continueRun(jobId, { fromSegment? })` (a NEW job that reuses the delivered segments and regenerates from `fromSegment` on, billed only for the regenerated part; works on stopped, failed, and completed runs). CLI: `nodaro video-pro stop <jobId>` and `nodaro video-pro continue <jobId> [--from-segment N] [--watch]`.

### Patch Changes

- Updated dependencies [7370b4d]
- Updated dependencies [606997d]
- Updated dependencies [2f32c1b]
- Updated dependencies [89bee09]
- Updated dependencies [0dedf9b]
- Updated dependencies [774a2d1]
  - @nodaro/sdk@1.8.0
  - @nodaro/shared@1.14.0
  - @nodaro/prompts@1.4.0

## 1.4.0

### Minor Changes

- 8c019ad: Full voice/media/audio command surface. `nodaro voice` gains the interactive Voice Changer Pro flow — `analyze` (detect speakers, prints the list), `recast --output video|stems` + `--analysis-json/--analysis-file` (reuse an analyze result, skip re-detection), and `export` (render a mixed track set, `--tracks-json/--tracks-file`) — plus `design`, `remix`, `dub`, `list [--clones]`, and `clones list|create|delete` (create from an uploaded URL or a local file); `voice changer` gains `--model`, `--use-speaker-boost`, `--seed`. New `nodaro media` group: `download` (social-video import with live `--watch` progress), `metadata`, `trim-video`, `trim-audio`, `save`. New `nodaro audio` group: `separate`, `isolate`, `fx`, `mix`, `adjust-volume`, `combine`.

### Patch Changes

- Updated dependencies [8c019ad]
  - @nodaro/sdk@1.6.0

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
  - @nodaro/sdk@1.3.0

## 1.2.0

### Minor Changes

- d53614b: Add `nodaro voice recast` (alias `voice pro`) — multi-speaker Voice Changer Pro from the CLI. `--voices` maps speakers in detection order (`--voices Rachel,keep,Aria`); the literal `keep` is a keep-slot — that speaker's original voice is kept (sent as a `null` entry, SDK ≥ 1.2.0). `--voices-json` accepts the raw SDK array (per-voice settings objects and `null` keep-slots), plus flags for model, background preservation, separation quality, music volume, noise removal, voice FX, and `--watch` polling.

### Patch Changes

- Updated dependencies [39bdbd7]
- Updated dependencies [da6af59]
  - @nodaro/shared@1.8.0

## 1.1.2

### Patch Changes

- 8661d4a: Registry restore after the license-split wipe: all pre-split packages were removed from npm (their Apache grants covered prompt craft that now lives in FSL-licensed `@nodaro/prompts`). npm permanently burns unpublished version numbers, so every package takes a patch bump. No code changes.
- Updated dependencies [8661d4a]
  - @nodaro/shared@1.4.1
  - @nodaro/prompts@1.0.1
  - @nodaro/sdk@1.1.1

## 1.1.1

### Patch Changes

- 37f1805: No functional changes. Republish so the npm provenance attestations reference the repository's current (post-history-rewrite) source commits — earlier versions' attested commit links point at rewritten-away SHAs.
- Updated dependencies [37f1805]
  - @nodaro/shared@1.2.1
  - @nodaro/sdk@1.0.3

## 1.1.0

### Minor Changes

- b9c84a0: `--param` / `--input` now accept JSON values: a value starting with `[`, `{`, or `"` is parsed as JSON (e.g. `--param 'targetPickers=["person"]'` sends a real array; `--param 'seed="123"'` forces a string). Bracket-leading values that are not valid JSON still pass through as plain strings, so prompts like `[cinematic] a leopard` are unaffected. Previously array/object parameters required `--params-file`.

### Patch Changes

- Updated dependencies [6bcdb96]
- Updated dependencies [6bcdb96]
- Updated dependencies [ccc07e7]
  - @nodaro/shared@1.2.0
  - @nodaro/sdk@1.0.2

## 1.0.0

### Major Changes

- a33d6ab: Remove the `popularIds` field from `presets.listFactory()` / `GET /v1/node-presets/factory`. The static "Popular" preset band has been removed in favor of a user-driven Favorites feature; `popularIds` is no longer returned.

### Minor Changes

- 5ab57c6: Add `nodaro projects create`, `nodaro projects update`, and `nodaro projects delete` subcommands. Projects now have full CRUD from the CLI, matching the `@nodaro/sdk` `projects` resource.
- c42a82f: Centralize community listing types in `@nodaro/shared` (single source of truth, re-exported by `@nodaro/sdk`), and add a `community` command group to `@nodaro/cli` (`browse`, `get`, `favorites`, `clone`, `favorite`, `report`) mirroring the SDK resource. Publishing remains admin/editor-only and is intentionally not exposed.
- 5585889: Admins can now share/unshare community listings via the SDK + CLI. `@nodaro/sdk`: `community.publish()`, `community.unpublish()`, `community.sharedListing()`. `@nodaro/cli`: `community publish/unpublish/shared-status`. (All require an admin token; publishing requires owning the source entity and, for characters, a likeness attestation.)
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

### Patch Changes

- e0aec7e: Correct the license statement in the `@nodaro/shared` and `@nodaro/sdk` READMEs (the packages are Apache-2.0, not the repository-root Sustainable Use License) and add `repository`/`homepage`/`bugs` metadata to all three published package.json files so npm links back to the source monorepo.
- Updated dependencies [ca65d28]
- Updated dependencies [c42a82f]
- Updated dependencies [5585889]
- Updated dependencies [3e14899]
- Updated dependencies [5c184c3]
- Updated dependencies [4909967]
- Updated dependencies [4260c1e]
- Updated dependencies [0f8bb8b]
- Updated dependencies [64d6d81]
- Updated dependencies [ddeb67a]
- Updated dependencies [bcf5e08]
- Updated dependencies [e6a514f]
- Updated dependencies [216f3bb]
- Updated dependencies [9798fad]
- Updated dependencies [acd2564]
- Updated dependencies [7a38259]
- Updated dependencies [b3f214b]
- Updated dependencies [fbcd7c8]
- Updated dependencies [5380a50]
- Updated dependencies [55e3782]
- Updated dependencies [bed0093]
- Updated dependencies [a33d6ab]
- Updated dependencies [e0aec7e]
- Updated dependencies [93adc04]
- Updated dependencies [7f38813]
  - @nodaro/sdk@1.0.0
  - @nodaro/shared@1.1.0
