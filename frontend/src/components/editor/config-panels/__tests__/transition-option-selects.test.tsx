/**
 * The transition panel renders a picked row's OWN options — declared on the
 * catalog row (`Transition.options`), so the Direction control appears beside
 * a wipe and nowhere else. `@nodaro/prompts` is NOT mocked: the rows are the
 * real catalog's.
 */
import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { DEBRIS_SHOWER_STYLE, GARDEN_BLOOM_STYLE, WIPE_DIRECTION } from "@nodaro/prompts"
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
// dropdowns beside them are under test. Everything else in the module is the
// real thing.
vi.mock("@/lib/picker-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/picker-ui")>()),
  TransitionPicker: () => null,
  CharacterFxPicker: () => null,
  CharacterMotionPicker: () => null,
}))

// Radix Select renders its items only while open (and not at all in jsdom
// without pointer events). Flatten it so every option — with the `title` the
// panel puts its catalog description into — is in the DOM.
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

/** An option's dropdown, located by its column label. */
function optionSelect(text: string): HTMLSelectElement | undefined {
  const label = screen.queryAllByText(text).find((el) => el.tagName === "LABEL")
  return label?.parentElement?.querySelector("select") ?? undefined
}
const directionSelect = () => optionSelect("Direction")
const styleSelect = () => optionSelect("Style")
const rows = (select: HTMLSelectElement) =>
  Array.from(select.querySelectorAll("option")).map((o) => [o.value, o.textContent])

describe("the transition panel's per-row options (a wipe's direction)", () => {
  it("a wipe shows the Direction dropdown with the catalog's rows, auto first", () => {
    renderTransition({ transition: "wipe" })
    const select = directionSelect()
    expect(select).toBeDefined()
    expect(Array.from(select!.querySelectorAll("option")).map((o) => [o.value, o.textContent, o.title])).toEqual(
      WIPE_DIRECTION.choices.map((c) => [c.id, c.label, c.description]),
    )
    expect(select!.value).toBe("auto")
  })

  it("a transition that declares no option shows no Direction dropdown", () => {
    renderTransition({ transition: "cross-dissolve" })
    expect(directionSelect()).toBeUndefined()
  })

  it("a two-pick with a wipe in it shows the wipe's Direction", () => {
    renderTransition({ transition: ["cross-dissolve", "wipe"], wipeDirection: "top-to-bottom" })
    expect(directionSelect()!.value).toBe("top-to-bottom")
  })

  it("choosing a direction stores its id; choosing auto clears the field", () => {
    const onUpdate = renderTransition({ transition: "wipe", wipeDirection: "left-to-right" })
    fireEvent.change(directionSelect()!, { target: { value: "bottom-to-top" } })
    expect(onUpdate).toHaveBeenLastCalledWith({ wipeDirection: "bottom-to-top" })
    fireEvent.change(directionSelect()!, { target: { value: "auto" } })
    expect(onUpdate).toHaveBeenLastCalledWith({ wipeDirection: undefined })
  })

  it("the composed preview carries the chosen direction", () => {
    renderTransition({ transition: "wipe", wipeDirection: "right-to-left" })
    expect(document.body.textContent).toContain(
      "linear wipe (a clean vertical edge sweeps across the frame from right to left, revealing the second shot behind it)",
    )
  })
})

describe("the transition panel's Style (a styled row's looks)", () => {
  it("a styled row shows Style with its looks, the default named, and stores the id", () => {
    const onUpdate = renderTransition({ transition: "debris-shower" })
    expect(rows(styleSelect()!)).toEqual(DEBRIS_SHOWER_STYLE.choices.map((c) => [c.id, c.label]))
    expect(rows(styleSelect()!)[0]).toEqual(["auto", "Full cover (default)"])
    expect(directionSelect()).toBeUndefined()
    fireEvent.change(styleSelect()!, { target: { value: "debris-shower-light-sweep" } })
    expect(onUpdate).toHaveBeenLastCalledWith({ style: "debris-shower-light-sweep" })
    fireEvent.change(styleSelect()!, { target: { value: "auto" } })
    expect(onUpdate).toHaveBeenLastCalledWith({ style: undefined })
  })

  it("two styled rows share ONE Style control; the second row's looks carry its name", () => {
    renderTransition({ transition: ["debris-shower", "garden-bloom"], style: "garden-bloom-hedge-doors" })
    expect(screen.queryAllByText("Style").filter((el) => el.tagName === "LABEL")).toHaveLength(1)
    expect(rows(styleSelect()!)).toEqual([
      ...DEBRIS_SHOWER_STYLE.choices.map((c) => [c.id, c.label]),
      ...GARDEN_BLOOM_STYLE.choices.slice(1).map((c) => [c.id, `Garden Bloom · ${c.label}`]),
    ])
    expect(styleSelect()!.value).toBe("garden-bloom-hedge-doors")
  })
})
