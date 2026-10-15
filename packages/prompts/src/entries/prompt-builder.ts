/**
 * `@nodaro/prompts/prompt-builder` — The prompt builder, structured fields, style section, direction and subject registries.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/prompts`.
 */
// This entry reaches the per-catalog getters, which consult the composed-catalog
// resolver (catalog-overlay.ts) whenever a catalog pack targets their catalog.
// picker-catalogs.ts installs that resolver when it loads, so it is loaded here
// for its side effect — a consumer of this entry alone must never resolve a
// curated catalog against stock text. Guarded by package-entries-resolver.test.ts.
import "../picker-catalogs.js"

export * from "../described-references.js"
export * from "../prompt-builder.js"
export * from "../prompt-builder-structured-fields.js"
export * from "../direction-registry.js"
export * from "../user-direction-refs.js"
export * from "../color-names.js"
export * from "../subject-registry.js"
export * from "../prompt-style-section.js"
export * from "../read-node-direction.js"
