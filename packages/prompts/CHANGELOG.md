# @nodaro/prompts

## 1.4.0

### Minor Changes

- 89bee09: `resolveSeedance2Inputs` accepts an optional `prompt` and suppresses the trailing "Use @image_N as the opening (first) frame" sentence when the prompt already binds a first frame itself (new `promptBindsFirstFrame` export). Field finding: the first-frame directive only reliably steers Seedance when adjacent to the extend colon; a duplicate sentence at the end dilutes it. The frame image still rides the reference list.

### Patch Changes

- Updated dependencies [606997d]
- Updated dependencies [2f32c1b]
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
