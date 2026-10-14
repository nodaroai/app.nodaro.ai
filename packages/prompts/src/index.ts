/**
 * @nodaro/prompts — creative/prompt IP shared across backend and
 * frontend but deliberately EXCLUDED from the published Apache packages.
 * Published to npm (`publishConfig.access: public`) so first-party clients
 * such as Studio can fold identically, under FSL-1.1-Apache-2.0 (free
 * non-competing use) — see `packages/prompts/LICENSE`. NOT Apache-2.0 like
 * `packages/{shared,client,cli}`; never merge prompt content back into those.
 *
 * Placement rule (root CLAUDE.md): new prompt engineering, catalogs,
 * doctrine, and presets default to backend/ or here — packages/shared gets
 * only what the public API contract requires.
 */

// The root is the union of the subpath entries in ./entries/ — one per domain,
// each published as `@nodaro/prompts/<entry>` (package.json "exports"). Add a new
// module's exports to the entry that owns its domain (or a new entry: also list
// it here and in package.json "exports"), never here: this file only re-exports
// entries, and package-entries.test.ts fails on anything else.
export * from "./entries/assembly.js"
export * from "./entries/catalog-packs.js"
export * from "./entries/doctrine.js"
export * from "./entries/person.js"
export * from "./entries/picker-art.js"
export * from "./entries/picker-catalogs.js"
export * from "./entries/pickers.js"
export * from "./entries/presets.js"
export * from "./entries/prompt-builder.js"
export * from "./entries/prompt-fields.js"
