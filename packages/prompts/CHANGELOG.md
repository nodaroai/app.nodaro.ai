# @nodaro/prompts

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
