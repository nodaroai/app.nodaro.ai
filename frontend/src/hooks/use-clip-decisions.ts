/**
 * A clip set's review decisions (§4.1 of the inspectors design, A4-1): Keep
 * and the hook of each planned clip, as inspector-local state, written back to
 * the Edit Plan (`writeClipDecisions`).
 *
 *  - Seeded from the plan's applied review, else every clip kept as planned,
 *    and again when the plan's basis changes (a re-plan).
 *  - Keep and Reset write at once. A hook edit is DEBOUNCED through the same
 *    writer as a Tighten review (`createReviewWriter`), and the pending write is
 *    flushed before Render final, close, Escape-to-close, unmount and
 *    `pagehide`, so a hook typed just before a click is neither lost nor saved
 *    after the run read the plan. The editor's `beforeunload` handlers flush it
 *    too (`flushPendingReviews`).
 *  - Reset removes the person's hook, so the plan's reads again; an empty
 *    textarea stores `hook: ""`, an explicit empty hook. Every clip kept with
 *    no hook of its own clears the review (R7 a, decided 2026-10-06).
 *  - Locked (R9 a), read-only or not a clip set: every operation is a no-op.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { editPlanBasis, type EditedClipDecision, type EditedClipSet } from "@nodaro/shared"
import { clipDecisionsOf } from "@/lib/edl-review/build-clip-cards"
import { clipReviewOf, createReviewWriter, writeClipDecisions } from "@/lib/edl-review/write-review"

/** What the decisions are read from: the plan behind the render, as stored. */
export interface ClipDecisionsSource {
  readonly planId: string | null
  /** The plan as stored (`generatedJson`). */
  readonly plan: unknown
  /** The plan's stored review (`editedEdl`). */
  readonly editedEdl: unknown
  readonly locked: boolean
}

export interface ClipDecisionEdits {
  /** One decision per planned clip; null when the plan is not a clip set. */
  readonly decisions: readonly EditedClipDecision[] | null
  /** What the plan will hold once written: the review, or `undefined` for none. */
  readonly pendingReview: EditedClipSet | undefined
  readonly canEdit: boolean
  readonly setKeep: (row: number, keep: boolean) => void
  readonly setHook: (row: number, hook: string) => void
  readonly resetHook: (row: number) => void
  /** Write the pending decisions now. */
  readonly flush: () => void
}

interface PendingWrite {
  readonly planId: string
  readonly plan: unknown
  readonly decisions: readonly EditedClipDecision[]
}

export function useClipDecisions(source: ClipDecisionsSource): ClipDecisionEdits {
  const { planId, plan, editedEdl, locked } = source
  const isClips = Array.isArray(plan) && !!planId
  const seedKey = isClips ? `${planId}\u0000${editPlanBasis(plan)}` : null

  const [state, setState] = useState<{ readonly key: string | null; readonly decisions: readonly EditedClipDecision[] | null }>(() => ({
    key: seedKey,
    decisions: seedKey ? clipDecisionsOf(plan, editedEdl) : null,
  }))
  let decisions = state.decisions
  if (state.key !== seedKey) {
    // A new plan (or none): reseed during render, before anything reads them.
    decisions = seedKey ? clipDecisionsOf(plan, editedEdl) : null
    setState({ key: seedKey, decisions })
  }
  // The decisions the next operation starts from, even when two arrive before a render.
  const decisionsRef = useRef(decisions)
  decisionsRef.current = decisions

  const writer = useMemo(() => createReviewWriter<PendingWrite>((w) => void writeClipDecisions(w.planId, w.plan, w.decisions)), [])
  useEffect(() => {
    const onPageHide = () => writer.flush()
    window.addEventListener("pagehide", onPageHide)
    return () => {
      window.removeEventListener("pagehide", onPageHide)
      writer.flush()
    }
  }, [writer])

  const canEdit = decisions !== null && !locked && isClips

  const commit = useCallback(
    (row: number, change: (d: EditedClipDecision) => EditedClipDecision, now: boolean) => {
      const current = decisionsRef.current
      if (!canEdit || !current || !planId || row < 0 || row >= current.length) return
      const next = current.map((d, i) => (i === row ? change(d) : d))
      decisionsRef.current = next
      setState({ key: seedKey, decisions: next })
      writer.schedule({ planId, plan, decisions: next })
      if (now) writer.flush()
    },
    [canEdit, planId, plan, seedKey, writer],
  )

  const setKeep = useCallback(
    (row: number, keep: boolean) => commit(row, (d) => ({ ...d, keep }), true),
    [commit],
  )
  const setHook = useCallback(
    (row: number, hook: string) => commit(row, (d) => ({ ...d, hook }), false),
    [commit],
  )
  const resetHook = useCallback(
    (row: number) => commit(row, (d) => ({ keep: d.keep }), true),
    [commit],
  )
  const flush = useCallback(() => writer.flush(), [writer])

  const pendingReview = useMemo(() => (decisions ? clipReviewOf(plan, decisions) : undefined), [plan, decisions])

  return { decisions, pendingReview, canEdit, setKeep, setHook, resetHook, flush }
}
