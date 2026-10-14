/**
 * The reviewer's edits (§2.2 of the inspectors design, A3-2): K, the kept
 * time, as inspector-local state, and every operation on it.
 *
 *  - Operations are the review model's pure steps (`lib/edl-review/`): cut a
 *    word range or a selection (`cutRange`), restore a span or a selection
 *    (`restoreSpan`, under the restore lock), restore or cut a whole reason.
 *    Cuts are never locked; a restore can return its lock, and leaves K as it
 *    was. An operation that changes nothing is not a step.
 *  - K is seeded from the model (the applied edit, else the plan) and again
 *    when the plan's basis changes (a re-plan). It is written back to the plan
 *    DEBOUNCED (`createReviewWriter`): every write of `editedEdl` wakes the
 *    whole editor. `flush()` writes the pending edit now; it runs before
 *    Update preview, Render final and close (the inspector's), on unmount and
 *    on `pagehide`. A reload is covered by the editor's own `beforeunload`
 *    handlers, which write every pending review (`flushPendingReviews`)
 *    before they read the store; `pagehide` alone fires too late for them.
 *  - Undo / redo (R8 a): the per-tab stack of `undo-stack.ts`, keyed by plan
 *    and basis, so it outlives the dialog.
 *  - Locked (R9 a), read-only or not reviewable: every operation is a no-op.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Edl, EditedEdlCut } from "@nodaro/shared/edl"
import { buildEdited } from "@/lib/edl-review/build-edited"
import type { Interval } from "@/lib/edl-review/intervals"
import { cutRange as cutRangeOf, cutReason as cutReasonOf, keptSetOf, snapToWords, type KeptSet } from "@/lib/edl-review/kept-set"
import { restoreReason as restoreReasonOf, restoreSpan as restoreSpanOf, type LockedSpan, type RestoreLock } from "@/lib/edl-review/restore"
import { selectionRange, type WordSelection } from "@/lib/edl-review/selection"
import { undoStackOf } from "@/lib/edl-review/undo-stack"
import { clearReview, createReviewWriter, reviewOf, writeReview } from "@/lib/edl-review/write-review"
import type { ReviewEditState } from "./review-edit-state"
import type { ReviewModel } from "./use-review-model"

export interface ReviewEdits extends ReviewEditState {
  /** K; null when the plan cannot be reviewed here. */
  readonly kept: KeptSet | null
  /** The edit K gives (`buildEdited`); null with no K. */
  readonly edited: Edl | null
  /** What the plan will hold once written: the edit, or `undefined` when K is the plan's own. */
  readonly pendingReview: EditedEdlCut | undefined
  readonly canEdit: boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly cutRange: (range: Interval) => void
  readonly cutSelection: (sel: WordSelection) => void
  readonly restoreSpan: (span: Interval) => RestoreLock | undefined
  readonly restoreSelection: (sel: WordSelection) => RestoreLock | undefined
  readonly restoreReason: (reason: string) => readonly LockedSpan[]
  readonly cutReason: (reason: string) => void
  readonly undo: () => void
  readonly redo: () => void
  /** "Reset to plan" (R7 a): K back at the plan's, the review cleared now. */
  readonly resetToPlan: () => void
  /** Remove an edit made on an earlier plan (it no longer applies). */
  readonly discardStaleEdit: () => void
  /** An edit here would replace another take's edit (`model.staleEditOfOtherTake`):
   *  the first one waits for `confirmReplace` (or `cancelReplace`), once per plan. */
  readonly replaceAsked: boolean
  readonly confirmReplace: () => void
  readonly cancelReplace: () => void
  /** Write the pending edit now. */
  readonly flush: () => void
}

interface PendingWrite {
  readonly planId: string
  readonly plan: unknown
  readonly base: Edl
  readonly kept: KeptSet
}

const sameKept = (a: KeptSet, b: KeptSet): boolean =>
  a === b || (a.length === b.length && a.every((p, i) => p.inMs === b[i]!.inMs && p.outMs === b[i]!.outMs))

export function useReviewEdits(model: ReviewModel): ReviewEdits {
  const { planId, plan, base, basis, seedKept, reviewable, locked, transcript, offsetMs, render, editStatus, staleEditOfOtherTake } = model
  const seedKey = planId && basis && base && reviewable && seedKept ? `${planId}\u0000${basis}` : null

  const [state, setState] = useState<{ readonly key: string | null; readonly kept: KeptSet | null }>(() => ({
    key: seedKey,
    kept: seedKey ? seedKept : null,
  }))
  let kept = state.kept
  if (state.key !== seedKey) {
    // A new plan (or none): reseed during render, before anything reads K.
    kept = seedKey ? seedKept : null
    setState({ key: seedKey, kept })
  }
  // The K the next operation starts from, even when two arrive before a render.
  const keptRef = useRef(kept)
  keptRef.current = kept

  const writer = useMemo(() => createReviewWriter<PendingWrite>((w) => void writeReview(w.planId, w.plan, w.base, w.kept)), [])
  useEffect(() => {
    const onPageHide = () => writer.flush()
    window.addEventListener("pagehide", onPageHide)
    return () => {
      window.removeEventListener("pagehide", onPageHide)
      writer.flush()
    }
  }, [writer])

  const canEdit = kept !== null && !locked && reviewable && !!base && !!planId && !!basis

  // Another take's edit is held on the node: the first edit here asks before
  // replacing it (decided 2026-10-13) — once per plan.
  const replaceOkFor = useRef<string | null>(null)
  const [replaceAsk, setReplaceAsk] = useState<{ readonly key: string | null; readonly next: KeptSet; readonly record: boolean; readonly reset?: boolean } | null>(null)

  const commit = useCallback(
    (next: KeptSet, record: boolean) => {
      const current = keptRef.current
      if (!canEdit || !current || !planId || !basis || !base || sameKept(next, current)) return
      if (staleEditOfOtherTake && replaceOkFor.current !== seedKey) {
        setReplaceAsk({ key: seedKey, next, record })
        return
      }
      if (record) undoStackOf(planId, basis).push(current)
      keptRef.current = next
      setState({ key: seedKey, kept: next })
      writer.schedule({ planId, plan, base, kept: next })
    },
    [canEdit, planId, basis, base, plan, seedKey, writer, staleEditOfOtherTake],
  )
  const replaceAsked = replaceAsk !== null && replaceAsk.key === seedKey
  const cancelReplace = useCallback(() => setReplaceAsk(null), [])

  const words = transcript?.words ?? []

  const cutRange = useCallback((range: Interval) => {
    const current = keptRef.current
    if (current) commit(cutRangeOf(current, range, words, offsetMs), true)
  }, [commit, words, offsetMs])

  const cutSelection = useCallback((sel: WordSelection) => {
    const range = selectionRange(sel, words, offsetMs)
    if (range) cutRange(range)
  }, [cutRange, words, offsetMs])

  const restoreSpan = useCallback((span: Interval): RestoreLock | undefined => {
    const current = keptRef.current
    if (!canEdit || !current || !base) return undefined
    const result = restoreSpanOf(current, base, span, render)
    if (result.lock) return result.lock
    commit(result.kept, true)
    return undefined
  }, [canEdit, base, render, commit])

  const restoreSelection = useCallback((sel: WordSelection): RestoreLock | undefined => {
    const range = selectionRange(sel, words, offsetMs)
    const span = range ? snapToWords(range, words, offsetMs) : null
    return span ? restoreSpan(span) : undefined
  }, [restoreSpan, words, offsetMs])

  const restoreReason = useCallback((reason: string): readonly LockedSpan[] => {
    const current = keptRef.current
    if (!canEdit || !current || !base) return []
    const result = restoreReasonOf(current, base, reason, render)
    commit(result.kept, true)
    return result.locked
  }, [canEdit, base, render, commit])

  const cutReason = useCallback((reason: string) => {
    const current = keptRef.current
    if (current && base) commit(cutReasonOf(current, base, reason), true)
  }, [base, commit])

  const undo = useCallback(() => {
    const current = keptRef.current
    if (!canEdit || !current || !planId || !basis) return
    const prev = undoStackOf(planId, basis).undo(current)
    if (prev) commit(prev, false)
  }, [canEdit, planId, basis, commit])

  const redo = useCallback(() => {
    const current = keptRef.current
    if (!canEdit || !current || !planId || !basis) return
    const next = undoStackOf(planId, basis).redo(current)
    if (next) commit(next, false)
  }, [canEdit, planId, basis, commit])

  // Never while edits are locked (a run under way, a read-only canvas): the
  // node's edit is what a starting final reads.
  const reset = useCallback(() => {
    if (!canEdit || !base) return
    commit(keptSetOf(base), true)
    writer.flush()
    // An edit that already equals the plan (K unchanged, nothing to write) goes too.
    if (planId) clearReview(planId)
  }, [canEdit, base, planId, commit, writer])
  const resetToPlan = useCallback(() => {
    if (!canEdit || !base) return
    // Reset clears the node's edit: another take's is asked about first, as an edit is.
    if (staleEditOfOtherTake && replaceOkFor.current !== seedKey) {
      setReplaceAsk({ key: seedKey, next: keptSetOf(base), record: true, reset: true })
      return
    }
    reset()
  }, [canEdit, base, staleEditOfOtherTake, seedKey, reset])

  const confirmReplace = useCallback(() => {
    if (!replaceAsk || replaceAsk.key !== seedKey) return
    // Locked since it was asked (a run started, the canvas turned read-only):
    // the other take's edit stays, and the question with it.
    if (!canEdit) return
    replaceOkFor.current = seedKey
    setReplaceAsk(null)
    if (replaceAsk.reset) reset()
    else commit(replaceAsk.next, replaceAsk.record)
  }, [replaceAsk, seedKey, canEdit, commit, reset])

  const discardStaleEdit = useCallback(() => {
    if (!locked && planId && editStatus === "stale") clearReview(planId)
  }, [locked, planId, editStatus])

  const flush = useCallback(() => writer.flush(), [writer])

  const edited = useMemo(() => (base && kept ? buildEdited(base, kept) : null), [base, kept])
  const pendingReview = useMemo(
    () => (base && kept && edited ? reviewOf(plan, base, kept, edited) : undefined),
    [plan, base, kept, edited],
  )
  const stack = planId && basis ? undoStackOf(planId, basis) : null

  return {
    kept,
    keptCount: kept ? kept.length : null,
    edited,
    pendingReview,
    canEdit,
    canUndo: canEdit && !!stack?.canUndo,
    canRedo: canEdit && !!stack?.canRedo,
    cutRange,
    cutSelection,
    restoreSpan,
    restoreSelection,
    restoreReason,
    cutReason,
    undo,
    redo,
    resetToPlan,
    discardStaleEdit,
    replaceAsked,
    confirmReplace,
    cancelReplace,
    flush,
  }
}
