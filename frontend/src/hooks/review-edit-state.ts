/**
 * What the review's checks and runs read of the reviewer's edits, whatever the
 * review is: a Tighten cut (`useReviewEdits`) or a clip set's decisions
 * (`useClipDecisions`, A4-2). Structural, so neither inspector owns the shape.
 */
import type { EditedEdl } from "@nodaro/shared"

export interface ReviewEditState {
  /** How much the review keeps (K's intervals, or the kept clips the render's
   *  wire sends); null while the inspector does not hold the edit. */
  readonly keptCount: number | null
  /** What the plan will hold once written: the edit, or `undefined` for none. */
  readonly pendingReview: EditedEdl | undefined
  /** Write the pending edit now. */
  readonly flush: () => void
}
