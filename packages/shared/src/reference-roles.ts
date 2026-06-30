// packages/shared/src/reference-roles.ts
import { DEFAULT_LABEL_BY_SOURCE, type ReferenceSource } from "./types.js"

/**
 * Per-source ORDERED preset role ids (most-useful first) for the editor's role
 * menu. The single source of truth for the curated vocabulary — every menu and
 * the resolver read from here. `Custom…` (free-form) is added by the UI, not
 * listed here. Each list MUST contain the source's `DEFAULT_LABEL_BY_SOURCE`
 * value (guarded by reference-roles.test.ts).
 */
export const REFERENCE_ROLE_PRESETS: Record<ReferenceSource, readonly string[]> = {
  "wired-character": ["person", "face", "clothes", "hair", "pose", "expression", "style"],
  "wired-face": ["face", "person", "expression", "style"],
  "wired-location": ["background", "atmosphere", "as-is", "empty background", "layout", "lighting", "style"],
  "wired-object": ["object", "shape", "material", "color", "texture", "style"],
  "wired-creature": ["creature", "anatomy", "markings", "pose", "color", "style"],
  "wired-image": ["object", "person", "face", "clothes", "background", "style", "pose", "texture"],
  "manual": ["object", "person", "face", "clothes", "background", "style", "pose", "texture"],
}

/** Canonical default role for a source — the value the editor pre-fills and the
 *  resolver falls back to. Aliased to `DEFAULT_LABEL_BY_SOURCE` so the two never
 *  drift. */
export function defaultRoleForSource(source: ReferenceSource): string {
  return DEFAULT_LABEL_BY_SOURCE[source]
}

/**
 * Render the inline reference phrase. `binding` is the caller-formatted slot
 * string: `"reference image A"` (image, lettered) or `"@image_3"` (video).
 * Most roles are nouns and slot into the default template; the two non-noun
 * specials get a hand-tuned phrasing so the prompt reads naturally.
 */
export function roleToPhrase(role: string, binding: string): string {
  const r = role.trim()
  if (!r) return binding
  switch (r) {
    case "as-is":
      return `${binding}, used as-is`
    case "empty background":
      return `the background from ${binding} (without its foreground objects)`
    default:
      return `the ${r} from ${binding}`
  }
}
