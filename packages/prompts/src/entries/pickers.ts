/**
 * `@nodaro/prompts/pickers` — The individual picker catalogs (setting, mood, lens, lighting, transitions, character motion, …).
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

export * from "../action-fx.js"
export * from "../aesthetic.js"
export * from "../atmosphere.js"
export * from "../backdrop.js"
export * from "../camera-format.js"
export * from "../camera-motions.js"
export * from "../character-fx.js"
export * from "../character-motion.js"
export * from "../color-look.js"
export * from "../composition-effects.js"
export * from "../era.js"
export * from "../exposure-settings.js"
export * from "../framing.js"
export * from "../held-prop.js"
export * from "../instrumentation.js"
export * from "../lens.js"
export * from "../lighting.js"
export * from "../loop-subject.js"
export * from "../materials.js"
export * from "../mood.js"
export * from "../music-genre.js"
export * from "../music-mood.js"
export * from "../photo-genre.js"
export * from "../photographer.js"
export * from "../pose.js"
export * from "../post-process-effects.js"
export * from "../render-quality.js"
export * from "../setting.js"
export * from "../style.js"
export * from "../styling.js"
export * from "../temporal.js"
export * from "../transitions.js"
export * from "../voice-character.js"
export * from "../voice-delivery.js"
export * from "../wardrobe.js"
export * from "../character-motion-diagnostics.js"
