import { NATIVE_NEGATIVE_VIDEO_PROVIDERS, getMaxVideoPromptChars } from "@nodaro/shared"

/**
 * The number of characters of BASE prompt a provider will actually keep.
 *
 * `applyVideoNegativePrompt` (`packages/shared/src/model-constants.ts`) is the
 * single clamp every video path runs through. For a provider with a native
 * negative param the base prompt gets the whole model cap. For every other
 * provider the clamp folds the negative in as a `"\nAvoid: <neg>"` suffix and
 * RESERVES room for it FIRST — `room = promptMax - avoid.length` — so the base
 * prompt is cut at `cap - suffix`, not at `cap`.
 *
 * The direction fold needs that same number, and PRIMARILY as its SHED BUDGET:
 * both video routes hand it to `composeVideoPromptText` as `opts.cap`, where it
 * decides how many direction hint clauses are dropped. So a wrong value here
 * mutates prompt CONTENT — too high sheds too little and hands the tail back to
 * the order-blind clamp (severing a reference binding or the end of the prose),
 * too low sheds a user-selected clause that would have fit. The routes' post-
 * assembly truncation warning is the same number's second, log-only consumer:
 * thresholding on the raw cap under-fires on exactly the runs that get truncated
 * (a prompt under the cap but over `cap - suffix` loses its tail silently). This
 * is the one place the reservation is mirrored, so the two video routes cannot
 * drift from each other — and a change to the suffix shape has one call site to fix.
 */
export function effectiveVideoPromptCeiling(
  provider: string,
  negativePrompt: string | undefined,
): number {
  const promptMax = getMaxVideoPromptChars(provider)
  const neg = negativePrompt?.trim()
  if (!neg || NATIVE_NEGATIVE_VIDEO_PROVIDERS.has(provider)) return promptMax
  // Mirrors `applyVideoNegativePrompt`'s non-native branch verbatim.
  return Math.max(0, promptMax - `\nAvoid: ${neg}`.length)
}
