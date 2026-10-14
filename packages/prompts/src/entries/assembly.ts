/**
 * `@nodaro/prompts/assembly` — Per-provider input assembly: image/video/Suno inputs, sound aggregation, video references, Seedance/Gemini Omni/Veo inputs, frame delivery, surround fill.
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

export * from "../video-reference-resolver.js"
export * from "../sound-aggregator.js"
export * from "../assemble-suno-input.js"
export * from "../assemble-image-input.js"
export * from "../assemble-video-input.js"
export * from "../seedance-2-inputs.js"
export * from "../gemini-omni-inputs.js"
export * from "../veo-i2v-inputs.js"
export * from "../surround-fill.js"
// --- Start/end frame delivery: one plan for the dispatch and the editor ---
export * from "../frame-delivery.js"
