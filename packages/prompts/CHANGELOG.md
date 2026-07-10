# @nodaro/prompts

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
