/**
 * `@nodaro/prompts/picker-catalogs` — The picker catalog registry, the composed-catalog overlay, parameter prompt hints, analyzers, wiring and the age floor.
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

export * from "../parameter-prompt-hint.js"
export * from "../picker-catalogs.js"
export * from "../catalog-overlay.js"
export * from "../shared-catalog-overlay.js"
export * from "../catalog-id-guard.js"
export * from "../age-floor.js"
export * from "../picker-analyzer-registry.js"
export * from "../picker-wiring.js"
