---
"@nodaro/prompts": minor
---

Subpath entry points: `@nodaro/prompts/<entry>` for `assembly`, `catalog-packs`, `doctrine`, `person`, `picker-art`, `picker-catalogs`, `pickers`, `presets`, `prompt-builder` and `prompt-fields` (ESM, CJS and types for each). Importing a subpath loads only that domain's modules instead of the whole package. Additive: the root `@nodaro/prompts` still exports every name it did, and is the union of the subpaths. Every subpath that resolves catalog entries installs the composed-catalog resolver itself, so catalog packs apply whichever subpath you load. The build is now split into shared chunks, so a value imported from a subpath and from the root is the same instance.

CJS only: because the CommonJS build is now split into chunks, its exports are defined as getters (enumerable, read-only) instead of writable data properties. Code that assigns to a `require()`d export or spies on it in place (for example `jest.spyOn` on the module object) must mock the module instead; ESM consumers are unaffected.
