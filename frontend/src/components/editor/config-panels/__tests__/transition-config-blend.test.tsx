/**
 * The Transition panel offers only the levers a pick actually takes (`transition-levers.ts`):
 *
 * - not every pick a cut (a non-cut, a cut with a non-cut): Position, Duration and Intensity, as before;
 * - every pick a cut that does not blend: Position without Full, and nothing else;
 * - every pick seamless-match / jump-match (the blendable cuts): Position without Full, and Blend —
 *   "Hard cut" (stored `auto`) or "Short (~1s)", the one step that blends a cut. No Intensity.
 *
 * A stored value a cut does not offer shows as what it renders (Auto / Hard cut), and nothing rewrites it.
 * `@nodaro/prompts` is NOT mocked: the rows and flags are the real catalog's.
 */
import { describe, it, expect, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { INSTANT_CUT_CLAUSE, TRANSITION_DURATIONS, TRANSITION_INTENSITIES, TRANSITION_POSITIONS } from "@nodaro/prompts"
import type { WorkflowNode } from "@/types/nodes"

// The only store consumer in this tree is the preview's hint-mode toggle.
vi.mock("@/hooks/use-workflow-store", () => {
  const noop = () => {}
  return {
    useWorkflowStore: Object.assign(
      (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ updateNode: noop, updateNodeData: noop }),
      { getState: () => ({ updateNode: noop, updateNodeData: noop }) },
    ),
  }
})

// LocaleHeader → LocalePicker drags in router + react-query providers we don't
// mount here; it's decorative for this test.
vi.mock("../locale-header", () => ({ LocaleHeader: () => null }))

// The tile-grid pickers are heavy and irrelevant here — only the timing
// dropdowns beside them are under test.
vi.mock("@/lib/picker-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/picker-ui")>()),
  TransitionPicker: () => null,
  CharacterFxPicker: () => null,
  CharacterMotionPicker: () => null,
}))

// Radix Select renders its items only while open; a native <select> keeps every
// option (with its `title`) in the DOM and exposes the shown value.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children?: React.ReactNode; value?: string; onValueChange?: (v: string) => void }) => (
    <select value={value} onChange={(e) => onValueChange?.(e.target.value)}>{children}</select>
  ),
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value, title }: { children?: React.ReactNode; value: string; title?: string }) => (
    <option value={value} title={title}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => <span />,
}))

import { TransitionConfig } from "../parameter-configs"
import { ParameterPreviewContext } from "../parameter-preview-context"

const BLEND = "instead of a hard cut, the two shots blend into each other over about 1 second"
const OTHER_CUTS = ["none", "snap-to-black", "match-cut", "smash-cut", "jump-cut", "action-relay"]
const BLENDABLE = ["seamless-match", "jump-match"]
const LEVER_LABELS = ["Position", "Duration", "Intensity", "Blend"] as const

function renderTransition(data: Record<string, unknown>, onUpdate = vi.fn()) {
  const node = { id: "transition-1", type: "transition", position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
  render(
    <ParameterPreviewContext.Provider value={{ node, nodes: [node], edges: [] }}>
      <TransitionConfig
        data={data as never}
        onUpdate={onUpdate}
        sources={[]}
        fieldMappings={{}}
        onMapField={() => {}}
        nodes={[node]}
      />
    </ParameterPreviewContext.Provider>,
  )
  return onUpdate
}

/** A timing dropdown, located by its column label. */
function lever(text: string): HTMLSelectElement | undefined {
  const label = screen.queryAllByText(text).find((el) => el.tagName === "LABEL")
  return label?.parentElement?.querySelector("select") ?? undefined
}
/** Which of the timing levers the panel shows, in order. */
const shownLevers = () => LEVER_LABELS.filter((l) => lever(l) !== undefined)
const rows = (select: HTMLSelectElement) =>
  Array.from(select.querySelectorAll("option")).map((o) => [o.value, o.textContent, o.title])
const catalogRows = (catalog: ReadonlyArray<{ id: string; label: string; description: string }>) =>
  catalog.map((o) => [o.id, o.label, o.description])
const CUT_POSITION_ROWS = catalogRows(TRANSITION_POSITIONS.filter((o) => o.id !== "full"))
const BLEND_ROWS = [
  ["auto", "Hard cut", "A single-frame cut. The two shots never blend."],
  ["short", "Short (~1s)", "Blend the two shots over about 1 second"],
]

describe("a pick that is not every-cut keeps today's three levers", () => {
  it.each([["cross-dissolve"], [["match-cut", "cross-dissolve"]], [["whip-pan", "seamless-match"]]])("%j", (transition) => {
    renderTransition({ transition })
    expect(shownLevers()).toEqual(["Position", "Duration", "Intensity"])
    expect(rows(lever("Position")!)).toEqual(catalogRows(TRANSITION_POSITIONS))
    expect(rows(lever("Duration")!)).toEqual(catalogRows(TRANSITION_DURATIONS))
    expect(rows(lever("Intensity")!)).toEqual(catalogRows(TRANSITION_INTENSITIES))
    expect(lever("Position")!.closest(".grid")!.className).toContain("grid-cols-3")
  })

  it("shows its stored values as stored, Full included", () => {
    renderTransition({ transition: "cross-dissolve", position: "full", duration: "medium", intensity: "crazy" })
    expect([lever("Position")!.value, lever("Duration")!.value, lever("Intensity")!.value]).toEqual(["full", "medium", "crazy"])
  })
})

describe("a cut that does not blend offers Position (no Full) and nothing else", () => {
  it.each(OTHER_CUTS)("%s", (transition) => {
    renderTransition({ transition })
    expect(shownLevers()).toEqual(["Position"])
    expect(rows(lever("Position")!)).toEqual(CUT_POSITION_ROWS)
    expect(lever("Position")!.closest(".grid")!.className).toContain("grid-cols-1")
  })

  it("two such cuts, or a blendable cut beside one, read the same", () => {
    for (const transition of [["match-cut", "smash-cut"], ["seamless-match", "match-cut"], ["jump-cut", "jump-match"]]) {
      cleanup()
      renderTransition({ transition })
      expect(shownLevers(), transition.join("+")).toEqual(["Position"])
    }
  })
})

describe("a blendable cut offers Position (no Full) and Blend: Hard cut or Short", () => {
  it.each([...BLENDABLE, ["seamless-match", "jump-match"], ["jump-match", "seamless-match"], ["auto", "seamless-match"]])("%j", (transition) => {
    renderTransition({ transition })
    expect(shownLevers()).toEqual(["Position", "Blend"])
    expect(rows(lever("Position")!)).toEqual(CUT_POSITION_ROWS)
    expect(rows(lever("Blend")!)).toEqual(BLEND_ROWS)
    expect(lever("Blend")!.value).toBe("auto")
    expect(lever("Position")!.closest(".grid")!.className).toContain("grid-cols-2")
  })

  it("Short shows as Short; every other stored duration shows as Hard cut, without rewriting it", () => {
    for (const [duration, shown] of [["short", "short"], ["medium", "auto"], ["long", "auto"], ["instant", "auto"], ["auto", "auto"]]) {
      cleanup()
      const onUpdate = renderTransition({ transition: "seamless-match", duration })
      expect(lever("Blend")!.value, duration).toBe(shown)
      expect(onUpdate).not.toHaveBeenCalled()
    }
  })

  it("choosing Short stores `short`; choosing Hard cut stores `auto`", () => {
    const onUpdate = renderTransition({ transition: "jump-match", duration: "short" })
    fireEvent.change(lever("Blend")!, { target: { value: "auto" } })
    expect(onUpdate).toHaveBeenLastCalledWith({ duration: "auto" })
    fireEvent.change(lever("Blend")!, { target: { value: "short" } })
    expect(onUpdate).toHaveBeenLastCalledWith({ duration: "short" })
  })

  it("the composed preview carries the blend at Short and the hard cut otherwise", () => {
    renderTransition({ transition: "seamless-match", duration: "short" })
    expect(document.body.textContent).toContain(BLEND)
    expect(document.body.textContent).not.toContain(INSTANT_CUT_CLAUSE)
    cleanup()
    renderTransition({ transition: "seamless-match", duration: "medium" })
    expect(document.body.textContent).toContain(INSTANT_CUT_CLAUSE)
    expect(document.body.textContent).not.toContain(BLEND)
  })
})

describe("a stored Full on a cut shows as Auto (what it renders), without rewriting it", () => {
  it.each(["match-cut", "seamless-match"])("%s", (transition) => {
    const onUpdate = renderTransition({ transition, position: "full", intensity: "crazy" })
    expect(lever("Position")!.value).toBe("auto")
    expect(lever("Intensity")).toBeUndefined()
    expect(onUpdate).not.toHaveBeenCalled()
    fireEvent.change(lever("Position")!, { target: { value: "end" } })
    expect(onUpdate).toHaveBeenLastCalledWith({ position: "end" })
  })
})
