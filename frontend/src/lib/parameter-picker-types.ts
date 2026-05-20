/**
 * Lightweight set of node types that have a parameter picker registration.
 *
 * Imported by `input-card.tsx` (presentation runtime) so the published-app
 * bundle doesn't drag in the full registry — which eagerly imports every
 * preview component, picker, and catalog. The full registry is only loaded
 * on demand by `picker-input-card.tsx` when one of these node types renders.
 *
 * Keep in sync with the kind:"single" + kind:"multi" entries in
 * `parameter-picker-registry.tsx`.
 */
export const PARAMETER_PICKER_NODE_TYPES = new Set<string>([
  "setting", "atmosphere", "style", "color-look", "mood", "photographer",
  "aesthetic", "era", "photo-genre", "backdrop", "render-quality",
  "composition-effects", "post-process-effects", "action-fx", "loop-subject",
  "camera-motion", "lens", "camera-format", "transition", "character-fx",
  "pose", "material", "animal", "vehicle", "weapon", "held-prop",
  "framing", "lighting", "person", "styling", "temporal", "exposure-settings",
  "music-genre", "music-mood", "instrumentation", "voice-character", "voice-delivery",
])

export function isParameterPickerNode(nodeType: string | undefined | null): boolean {
  return PARAMETER_PICKER_NODE_TYPES.has(nodeType ?? "")
}

/** Audio-domain pickers — only feed Suno / ElevenLabs / MiniMax generators,
 *  never the `cinematography` handle on image/video nodes. */
export const AUDIO_PARAMETER_PICKER_NODE_TYPES: ReadonlySet<string> = new Set([
  "music-genre", "music-mood", "instrumentation", "voice-character", "voice-delivery",
])

/** Visual-domain pickers — the suitable sources for the `cinematography`
 *  target handle on still-image and video generation nodes. */
export const VISUAL_PARAMETER_PICKER_NODE_TYPES: ReadonlySet<string> = new Set(
  Array.from(PARAMETER_PICKER_NODE_TYPES).filter((t) => !AUDIO_PARAMETER_PICKER_NODE_TYPES.has(t)),
)
