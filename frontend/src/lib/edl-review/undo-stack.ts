/**
 * The review's undo history (R8 a, decided 2026-10-06): a per-tab, in-memory
 * stack per Edit Plan and plan basis. It lives in this module, not in the
 * dialog, so closing the inspector by mistake (Escape, a click outside) costs
 * nothing: reopening the same plan gets its history back. A new basis (the plan
 * was re-run) drops the plan's history, since its states belong to another
 * plan; a reload drops everything. Capped at UNDO_LIMIT steps, oldest first out.
 *
 * Each step is a whole K (KeptSet): states are small canonical interval sets,
 * and storing them whole keeps undo exact, whatever the operation was.
 */
import type { KeptSet } from "./kept-set"

export const UNDO_LIMIT = 200

export interface UndoStack {
  readonly canUndo: boolean
  readonly canRedo: boolean
  /** Record the K an edit is about to replace. Clears what could be redone. */
  push(before: KeptSet): void
  /** The K before the last edit, given the current one; undefined when none. */
  undo(current: KeptSet): KeptSet | undefined
  /** The K the last undo replaced, given the current one; undefined when none. */
  redo(current: KeptSet): KeptSet | undefined
}

interface History {
  readonly basis: string
  readonly past: KeptSet[]
  readonly future: KeptSet[]
}

const histories = new Map<string, History>()

function stackOver(history: History): UndoStack {
  return {
    get canUndo() {
      return history.past.length > 0
    },
    get canRedo() {
      return history.future.length > 0
    },
    push(before) {
      history.past.push(before)
      if (history.past.length > UNDO_LIMIT) history.past.splice(0, history.past.length - UNDO_LIMIT)
      history.future.length = 0
    },
    undo(current) {
      const prev = history.past.pop()
      if (prev !== undefined) history.future.push(current)
      return prev
    },
    redo(current) {
      const next = history.future.pop()
      if (next !== undefined) history.past.push(current)
      return next
    },
  }
}

/** The history of `planId`'s review on the plan with `basis`. */
export function undoStackOf(planId: string, basis: string): UndoStack {
  let history = histories.get(planId)
  if (!history || history.basis !== basis) {
    history = { basis, past: [], future: [] }
    histories.set(planId, history)
  }
  return stackOver(history)
}

/** Forget every history (tests). */
export function resetUndoStacks(): void {
  histories.clear()
}
