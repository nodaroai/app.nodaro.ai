/**
 * Writing a Tighten review to its Edit Plan (TA13, TA14; R7 a, decided
 * 2026-10-06). The inspector holds K; this file turns K into the stored edit
 * and writes it, and holds no state of its own.
 *
 *  - `reviewOf`: the edit K gives, `{v:1, kind:"edl", basis, edl:{segments,
 *    dropped}}`, against `editPlanBasis` of the plan as stored. `undefined`
 *    when K is the plan's own: an un-edited plan holds no edit, so it never
 *    shows EDITED and a re-plan never warns about nothing.
 *  - `writeReview`: the store write. With no edit it calls `clearReview`.
 *  - `clearReview`: the SECOND place a review is cleared (the first is a plan
 *    landing, `editPlanResultPatch`). "Reset to plan", the writer when K is back
 *    at the plan's, and discarding an edit made on an earlier plan use it.
 *    `edit-plan-saved-output-sites.test.ts` allows exactly these two.
 *  - `withPendingReview`: the canvas with the not-yet-written edit in place (a
 *    pure overlay, no store write), so the footer gate never lags the write.
 *  - `createReviewWriter`: the debounce. Every write of `editedEdl` (0.3–1 MB on
 *    a long episode) wakes every store subscriber, so K is written after
 *    REVIEW_WRITE_IDLE_MS without an edit and at most every
 *    REVIEW_WRITE_MAX_WAIT_MS during a burst; `flush()` writes the pending
 *    value now (before Update preview, Render final, close and `pagehide`).
 *  - `flushPendingReviews`: every writer holding a value, flushed now. The
 *    editor's `beforeunload` handlers call it BEFORE they read the store (the
 *    keepalive save and the leave prompt), so a reload never misses the last
 *    edit. Listener order cannot do this: the inspector mounts after the
 *    editor, so its own listener would run after the editor's had read.
 */
import { EDITED_EDL_VERSION, editPlanBasis, type Edl, type EditedEdlCut } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { buildEdited } from "./build-edited"
import { keptSetOf, type KeptSet } from "./kept-set"

export const REVIEW_WRITE_IDLE_MS = 400
export const REVIEW_WRITE_MAX_WAIT_MS = 2000

const sameKept = (a: KeptSet, b: KeptSet): boolean =>
  a.length === b.length && a.every((p, i) => p.inMs === b[i]!.inMs && p.outMs === b[i]!.outMs)

/** The stored edit K gives on `plan` (`base` is `normalizeEdl(plan)`), or
 *  `undefined` when K is the plan's own. Pass `edited` when it is at hand. */
export function reviewOf(plan: unknown, base: Edl, kept: KeptSet, edited?: Edl): EditedEdlCut | undefined {
  if (sameKept(kept, keptSetOf(base))) return undefined
  const cut = edited ?? buildEdited(base, kept)
  return {
    v: EDITED_EDL_VERSION,
    kind: "edl",
    basis: editPlanBasis(plan),
    edl: { segments: cut.segments, dropped: cut.dropped ?? [] },
  }
}

/** The plan node's data, when it still holds `plan` (the same object). */
function planData(planId: string, plan: unknown): Readonly<Record<string, unknown>> | undefined {
  const node = useWorkflowStore.getState().nodes.find((n) => n.id === planId)
  const data = node?.data as Readonly<Record<string, unknown>> | undefined
  return data && data.generatedJson === plan ? data : undefined
}

/**
 * Write K's review to the plan node. Skipped when the node no longer holds
 * `plan` (a re-plan landed meanwhile: the edit belongs to the old plan, and
 * writing it would only store a stale edit). Returns whether it wrote.
 */
export function writeReview(planId: string, plan: unknown, base: Edl, kept: KeptSet, edited?: Edl): boolean {
  if (!planData(planId, plan)) return false
  const review = reviewOf(plan, base, kept, edited)
  if (!review) return clearReview(planId)
  useWorkflowStore.getState().updateNodeData(planId, { editedEdl: review })
  return true
}

/** Remove the plan's review: the plan is read as planned again. Returns
 *  whether there was one to remove. */
export function clearReview(planId: string): boolean {
  const node = useWorkflowStore.getState().nodes.find((n) => n.id === planId)
  if ((node?.data as Record<string, unknown> | undefined)?.editedEdl === undefined) return false
  useWorkflowStore.getState().updateNodeData(planId, { editedEdl: undefined })
  return true
}

/** `nodes` with the plan's `editedEdl` replaced by `review` (none when
 *  undefined). Every other node is returned as it is. */
export function withPendingReview<N extends { readonly id: string; readonly data?: unknown }>(
  nodes: readonly N[],
  planId: string,
  review: EditedEdlCut | undefined,
): N[] {
  return nodes.map((n) => (n.id === planId ? ({ ...n, data: { ...(n.data as object), editedEdl: review } } as N) : n))
}

export interface ReviewWriter<T> {
  /** Write `value` once the edits pause (or the burst's wait runs out). */
  schedule(value: T): void
  /** Write the pending value now, if there is one. */
  flush(): void
  /** Drop the pending value. */
  cancel(): void
  readonly pending: boolean
}

/** The writers holding a value not yet written. A writer joins on `schedule`
 *  and leaves on `flush` / `cancel`, so one created and never used, or one
 *  whose owner unmounted (which flushes), is never held here. */
const pendingWriters = new Set<ReviewWriter<unknown>>()

/** Write every pending review now. Call before reading the store to save it. */
export function flushPendingReviews(): void {
  for (const writer of [...pendingWriters]) writer.flush()
}

export function createReviewWriter<T>(
  write: (value: T) => void,
  idleMs = REVIEW_WRITE_IDLE_MS,
  maxWaitMs = REVIEW_WRITE_MAX_WAIT_MS,
): ReviewWriter<T> {
  let pending: { value: T } | null = null
  let idle: ReturnType<typeof setTimeout> | null = null
  let maxWait: ReturnType<typeof setTimeout> | null = null
  const clearTimers = () => {
    if (idle !== null) clearTimeout(idle)
    if (maxWait !== null) clearTimeout(maxWait)
    idle = null
    maxWait = null
  }
  const flush = () => {
    clearTimers()
    pendingWriters.delete(writer)
    if (!pending) return
    const { value } = pending
    pending = null
    write(value)
  }
  const writer: ReviewWriter<T> = {
    schedule(value) {
      pending = { value }
      pendingWriters.add(writer)
      if (idle !== null) clearTimeout(idle)
      idle = setTimeout(flush, idleMs)
      if (maxWait === null) maxWait = setTimeout(flush, maxWaitMs)
    },
    flush,
    cancel() {
      clearTimers()
      pendingWriters.delete(writer)
      pending = null
    },
    get pending() {
      return pending !== null
    },
  }
  return writer
}
