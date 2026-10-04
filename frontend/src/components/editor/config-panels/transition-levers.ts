import {
  TRANSITION_DURATIONS,
  TRANSITION_INTENSITIES,
  TRANSITION_POSITIONS,
  getTransitionTerm,
  isBlendableTransition,
  isInstantTransition,
  type TransitionTimingOption,
} from "@nodaro/prompts"
import { pickIds } from "@nodaro/shared"

/**
 * WHICH timing levers the Transition panel offers for a pick, and which rows —
 * the levers the composer actually reads (`composeTransitionHintFromConnections`):
 *
 * - `timed` (a non-cut, a cut picked with a non-cut, or nothing): Position,
 *   Duration and Intensity, every row of each catalog.
 * - `cut` (every pick a cut that does not blend): Position without `full` — a
 *   single-frame cut spans nothing — and nothing else; the composer drops a
 *   cut's duration and intensity.
 * - `blendable-cut` (every pick `seamless-match` / `jump-match`): Position
 *   without `full`, and the Duration offered as a BLEND lever: `auto` (a hard
 *   cut) plus the steps that blend a cut (`blendsCut`: Short). No Intensity.
 *
 * Read off the catalog flags (`isInstantTransition`, `isBlendableTransition`,
 * `blendsCut`), never a list of ids, over the ids that contribute a fragment —
 * the composer's own filter, so `["auto", "seamless-match"]` is a blendable cut.
 */
export type TransitionPickKind = "timed" | "cut" | "blendable-cut"

export type TransitionLeverField = "position" | "duration" | "intensity"

export interface TransitionLever {
  readonly field: TransitionLeverField
  /** `blend`: the Duration lever of a blendable cut (labelled Blend, `auto` = a hard cut). */
  readonly variant: "timing" | "blend"
  readonly options: ReadonlyArray<TransitionTimingOption>
}

export function transitionPickKind(value: unknown): TransitionPickKind {
  // The composer's own reading of a pick: at most two ids, the ones with a term.
  const ids = pickIds(value).slice(0, 2).filter((id) => getTransitionTerm(id).length > 0)
  if (!isInstantTransition(ids)) return "timed"
  return isBlendableTransition(ids) ? "blendable-cut" : "cut"
}

const CUT_POSITIONS: ReadonlyArray<TransitionTimingOption> = TRANSITION_POSITIONS.filter((o) => o.id !== "full")
const BLEND_STEPS: ReadonlyArray<TransitionTimingOption> = (
  TRANSITION_DURATIONS as ReadonlyArray<TransitionTimingOption>
).filter((o) => o.id === "auto" || o.blendsCut === true)

export function transitionLevers(kind: TransitionPickKind): ReadonlyArray<TransitionLever> {
  if (kind === "timed") {
    return [
      { field: "position", variant: "timing", options: TRANSITION_POSITIONS },
      { field: "duration", variant: "timing", options: TRANSITION_DURATIONS },
      { field: "intensity", variant: "timing", options: TRANSITION_INTENSITIES },
    ]
  }
  const position: TransitionLever = { field: "position", variant: "timing", options: CUT_POSITIONS }
  if (kind === "cut") return [position]
  return [position, { field: "duration", variant: "blend", options: BLEND_STEPS }]
}

/**
 * The row a lever shows for the stored value. On a cut, a stored value the
 * lever does not offer (`full`; a duration that does not blend; anything on a
 * lever a cut hides) shows as `auto` — which is what it renders: no position
 * clause, a hard cut. Display only: nothing rewrites the stored value. A timed
 * pick shows the stored value as it always has.
 */
export function transitionLeverValue(kind: TransitionPickKind, lever: TransitionLever, stored: unknown): string {
  const value = (stored as string | undefined) ?? "auto"
  if (kind === "timed") return value
  return lever.options.some((o) => o.id === value) ? value : "auto"
}
