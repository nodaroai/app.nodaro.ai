import { generateCharacterAsset } from "@/lib/api"
import type { CharacterStudioState } from "./use-character-studio"
import type { CharacterStudioJobs } from "./use-character-studio-jobs"

/**
 * Auto-chain helper: when a character has NO body angles, generate a
 * canonical front body angle FIRST and wait for it, then return its URL so
 * the caller can hand it to the motion generation as `sourceImageUrl`.
 *
 * Motion generation looks much better when the source frame is a full-body
 * shot than when it's a head-and-shoulders portrait. The backend's
 * `generate-character-motion` route also prefers `body_angles.front`, so
 * this client-side chain just ensures the row HAS one before kicking off
 * motion — closing the gap for first-time motions.
 *
 * Returns:
 *   - the new body-angle URL when generation succeeded;
 *   - `null` when the user already has body angles (caller skips the chain
 *     and lets the backend pick from the DB);
 *   - throws when the body-angle gen fails / is cancelled. The caller must
 *     surface the error and NOT proceed to motion gen — kicking off the
 *     i2v on a portrait when we promised a full-body would silently
 *     downgrade the user's clip.
 *
 * The body-angle job is `trackAndWait()`-ed via the studio's existing job
 * hook, so the user sees a spinner card in the body-angles grid (in the
 * Appearance tab — they may have switched tabs but the gen is still
 * happening). On completion, the modal's `onResolved` callback also merges
 * the result into `state.staged.bodyAngles[]` for free.
 *
 * Extracted into its own file so the auto-chain logic is unit-testable
 * without rendering MotionsTab + the whole studio state machine.
 */
export async function ensureBodyAngleForMotion({
  state,
  jobs,
  characterId,
  provider,
}: {
  state: CharacterStudioState
  jobs: CharacterStudioJobs
  characterId: string
  provider: string
}): Promise<string | null> {
  const existing = state.staged.bodyAngles
  if (existing && existing.length > 0) {
    // Already have a body angle — backend's resolver will pick the best one
    // (prefers `front`, falls back to last-saved). No work to do here.
    return null
  }

  const { jobId } = await generateCharacterAsset({
    assetType: "bodyAngles",
    variant: "front",
    name: state.staged.characterName,
    description: state.staged.description,
    gender: state.staged.gender,
    style: state.staged.style,
    baseOutfit: state.staged.baseOutfit,
    sourceImageUrl: state.staged.sourceImageUrl || undefined,
    // Use a strong default image model — the studio's bodyAngles dropdown
    // doesn't expose a model picker for the auto-chain path, and the
    // body-angle reference is what determines motion quality downstream.
    provider,
    attachToCharacterId: characterId,
    attachToColumn: "body_angles",
    attachName: "front",
    characterNodeAspectRatio: state.staged.defaultAssetAspectRatio,
  })

  // trackAndWait registers a waiter that resolves on completion via the
  // existing 2s poll loop, AND adds a spinner card to the body-angles grid
  // so the user sees progress. The waiter rejects on failure / cancellation
  // / studio close so callers always get a definitive outcome.
  const url = await jobs.trackAndWait(jobId, "bodyAngles", "front")
  return url
}
