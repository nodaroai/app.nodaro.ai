---
"@nodaro/prompts": patch
"@nodaro/shared": patch
---

fix(composition-effects): add a neutral `none` default and de-duplicate `3x3-grid-collage`.

- The `composition-effects` picker defaulted to `bursting-through-frame`, a heavy 3D paper-tear, so every unconfigured node injected a dramatic subject transform the user never asked for. The catalog now leads with a neutral `none` entry (empty `promptHint`) and defaults to it — the same no-op-entry convention `transitions` and `character-fx` use for their `auto` default, which keeps the advertised `defaultValue` a real member of the option list every consumer enumerates. Changed in both `@nodaro/prompts` sources that carry it (`PICKER_CATALOGS` and `ALL_PICKER_WIRING`), and localized in all 11 locales (`@nodaro/shared`).
- `3x3-grid-collage` existed under the same id in both `framing/composition` and `composition-effects`. It is removed from the composition-effects catalog (`@nodaro/prompts`) and all 11 i18n locales (`@nodaro/shared`); the `framing` entry stays as the canonical one.
