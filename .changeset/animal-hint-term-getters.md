---
"@nodaro/shared": minor
"@nodaro/prompts": patch
---

Animal prompt phrasing gets one owner: new `getAnimalPromptHint(id)` / `getAnimalTerm(id)` in `@nodaro/shared`, next to the `ANIMALS` catalog they read. "featuring a {label}, {description}" had two independent copies — the picker-catalog funnel's synthesized `promptHint` and `getParameterPromptHint`'s `animal` case — and both now call the getters instead of re-authoring the sentence. Output is byte-identical; the getters return `""` on an unknown, empty or absent id, exactly like every `get*PromptHint` in `@nodaro/prompts`.

They live in `@nodaro/shared` rather than `@nodaro/prompts` because the incoming `subject` prompt channel needs a third caller, and a getter under `packages/prompts/src` that read the raw `ANIMALS` array would be a new offender against the catalog-funnel ratchet. `getAnimalTerm` therefore carries a local copy of `deriveTerm`'s mechanical label derivation (`@nodaro/prompts` depends on `@nodaro/shared`, never the reverse), pinned entry-by-entry against the original by a new parity test.
