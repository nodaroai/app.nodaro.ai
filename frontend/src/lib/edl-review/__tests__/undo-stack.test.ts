import { beforeEach, describe, it, expect } from "vitest"
import type { KeptSet } from "../kept-set"
import { resetUndoStacks, UNDO_LIMIT, undoStackOf } from "../undo-stack"

const k = (n: number): KeptSet => [{ inMs: 0, outMs: n }]

/** R8 a (decided 2026-10-06): a per-tab stack keyed by plan + basis, capped at 200 steps. */
describe("the review's undo stack", () => {
  beforeEach(() => resetUndoStacks())

  it("undoes and redoes, and a new edit clears what could be redone", () => {
    const stack = undoStackOf("plan", "b1")
    stack.push(k(1))
    stack.push(k(2))
    expect(stack.undo(k(3))).toEqual(k(2))
    expect(stack.undo(k(2))).toEqual(k(1))
    expect(stack.undo(k(1))).toBeUndefined()
    expect(stack.redo(k(1))).toEqual(k(2))
    expect(stack.canRedo).toBe(true)
    stack.push(k(2))
    expect(stack.canRedo).toBe(false)
  })

  it("outlives the dialog: the same plan and basis get the same history back", () => {
    undoStackOf("plan", "b1").push(k(1))
    expect(undoStackOf("plan", "b1").canUndo).toBe(true)
    expect(undoStackOf("other", "b1").canUndo).toBe(false)
  })

  it("a new basis (a re-plan) drops the plan's history", () => {
    undoStackOf("plan", "b1").push(k(1))
    expect(undoStackOf("plan", "b2").canUndo).toBe(false)
    expect(undoStackOf("plan", "b1").canUndo).toBe(false)
  })

  it("keeps the newest 200 steps", () => {
    const stack = undoStackOf("plan", "b1")
    for (let i = 0; i < UNDO_LIMIT + 50; i++) stack.push(k(i))
    let steps = 0
    let current = k(-1)
    for (let prev = stack.undo(current); prev; prev = stack.undo(current)) {
      current = prev
      steps++
    }
    expect(steps).toBe(UNDO_LIMIT)
    expect(current).toEqual(k(50))
  })
})
