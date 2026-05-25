/**
 * Phase 2 (granular-pipeline-control) — user-facing labels for the
 * `SceneSpec.emotional_beat` enum.
 *
 * The schema enum (defined in `packages/shared/src/pipeline-types.ts` as
 * EMOTIONAL_BEAT) is screenwriting jargon — `inciting`, `rising`, `fall`,
 * `release`, `shock`, etc. Regular users don't read that. This map is the
 * UI-side rename: display these labels in the panel, keep the enum values
 * in form state / API calls / DB.
 *
 * Used by every pipeline UI surface that renders an emotional_beat:
 *   - script-panel.tsx (Story moment dropdown in the active scene card)
 *   - scene-card.tsx   (pipeline-panel scene preview card)
 *   - scripting-view.tsx (canvas SceneNode's scripting sub-view)
 *
 * NOT used by the canvas SceneNode config panel (scene-configs.tsx) — that
 * still uses a free-text input rather than the constrained dropdown and is
 * a separate canvas-side surface.
 */

export const STORY_MOMENT_LABELS = {
  setup: "Setup",
  inciting: "Opening",
  rising: "Building tension",
  climax: "Climax",
  fall: "Aftermath",
  release: "Resolution",
  shock: "Surprise / Reveal",
  // Best-fit guesses for the two enum values not in the original spec:
  release_humor: "Comic relief",
  reflection: "Reflection",
} as const

export type StoryMomentKey = keyof typeof STORY_MOMENT_LABELS

/**
 * Friendly label for a schema enum value. Falls back to the raw enum
 * string (with underscores → spaces) for any value the map doesn't cover —
 * defensive against schema additions that haven't been mapped yet.
 */
export function storyMomentLabel(beat: string | null | undefined): string {
  if (!beat) return ""
  if (beat in STORY_MOMENT_LABELS) {
    return STORY_MOMENT_LABELS[beat as StoryMomentKey]
  }
  return beat.replace(/_/g, " ")
}
