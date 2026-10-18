import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Profiler } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { budgetMs, threeHourSession } from "@/lib/edl-review/__tests__/three-hour-fixture"
import { ReviewInspector } from "../review-inspector"
import { EditorListeners, createWoke } from "./editor-listeners"
import { layOut, loadCanvas, wordEl, wordGestures } from "./review-test-canvas"

/**
 * The end-to-end cut budget (§2.4 of the inspectors design): ≤ 16 ms from a
 * cut keystroke to the next commit, on the 3-hour episode (30k words, 3k
 * drops), with the editor's store subscribers mounted beside the inspector
 * (editor-listeners.tsx).
 * The debounced write (§2.2) is what keeps them asleep: a cut changes the
 * inspector's own K and nothing in the store, so none of them runs, and the
 * keystroke's commit is the inspector's alone. The flushed write itself is
 * measured in A3-2 (review-write.scale.test.ts).
 *
 * Timed like the other budgets (three-hour-fixture.ts): the fastest of five
 * cuts. The reasons panel and the footer read the edit deferred
 * (`useDeferredValue`), so their counts and lengths land in the commit after
 * the strike, not in the keystroke's.
 *
 * GATED here: no store subscriber wakes on a cut (the invariant the debounced
 * write buys). RECORDED here, not gated: the commit's time. jsdom and React's
 * development build are not what the budget is for (~17 ms on a fast laptop,
 * most of it React's dev build and jsdom). The 16 ms budget is ASSERTED in a
 * real browser on a production build instead (decided 2026-10-07):
 * playwright/perf/review-cut.perf.spec.ts. CI runs that test on every PR
 * touching the inspector or its model, at twice the budget (32 ms) as a
 * tripwire (review-cut-budget.yml); a manual run asserts 16 ms.
 */
const { base, transcript } = threeHourSession()
const plan = JSON.parse(JSON.stringify(base)) as Record<string, unknown>

const woke = createWoke()

let page: ReturnType<typeof layOut>
beforeEach(() => {
  resetUndoStacks()
  page = layOut()
  loadCanvas({ plan, transcript })
})
afterEach(() => {
  cleanup()
  page.restore()
})

describe("the end-to-end cut budget (§2.4)", () => {
  it("commits a cut keystroke waking none of the editor's store subscribers, and records how long it took", async ({ annotate }) => {
    let committedAt = 0
    const onRender = () => {
      if (committedAt === 0) committedAt = performance.now()
    }
    render(
      <>
        <EditorListeners woke={woke} renderId="cut" />
        <Profiler id="review" onRender={onRender}>
          <ReviewInspector open renderId="cut" onClose={() => {}} />
        </Profiler>
      </>,
    )
    const { drag } = wordGestures(page)
    const timings: number[] = []
    // Five cuts of two words, each on a row on screen, each still kept.
    const firsts = [...document.querySelectorAll<HTMLElement>("[data-w][data-state='kept']")]
      .map((el) => Number(el.dataset.w))
      .filter((w, i, all) => all.includes(w + 1) && i % 12 === 0)
      .slice(0, 5)
    expect(firsts).toHaveLength(5)
    for (const first of firsts) {
      drag(first, first + 1)
      const before = { ...woke }
      committedAt = 0
      const start = performance.now()
      act(() => {
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Delete" })
      })
      expect(wordEl(first)!.dataset.state).toBe("cut")
      timings.push(committedAt - start)
      // Nothing in the store changed: the canvas, the badges, the bar and autosave slept.
      expect(woke).toEqual(before)
    }
    const fastest = Math.min(...timings)
    expect(fastest).toBeGreaterThan(0)
    await annotate(`cut keystroke → commit: ${fastest.toFixed(1)} ms (target ${budgetMs(16)} ms, recorded only)`, fastest <= budgetMs(16) ? "notice" : "warning")
  })
})
