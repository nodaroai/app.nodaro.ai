import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import {
  estimateGridCols,
  nextNavIndex,
  handleConfigPanelNavKeyDown,
  applyRovingTabIndex,
  createRovingTabIndexRef,
} from "../config-keyboard-nav"
import { DimensionTileGrid, TileCommitContext } from "../dimension-tile-grid"
import { PersonPickerDetailed } from "../person-picker-detailed"
import type { DimensionEntry } from "../dimension-modal-browser"

// PersonPickerDetailed full-render + getByRole over its large tree is slow on
// CI runners (same reasoning as person-picker.test.tsx). Scoped to this file.
vi.setConfig({ testTimeout: 15000 })

/**
 * Guard tests for config-panel keyboard navigation — the invariant that every
 * picker surface (tile grids, hand-rolled tablists, radiogroup tile rows) is
 * fully operable without a mouse. If a refactor reintroduces the old
 * canvas-level key hijacking or drops a local handler, these fail.
 */

// ---------------------------------------------------------------- pure math ---

describe("nextNavIndex", () => {
  it("ArrowRight wraps at the end", () => {
    expect(nextNavIndex("ArrowRight", 0, 5, 3)).toBe(1)
    expect(nextNavIndex("ArrowRight", 4, 5, 3)).toBe(0)
  })

  it("ArrowLeft wraps at the start", () => {
    expect(nextNavIndex("ArrowLeft", 2, 5, 3)).toBe(1)
    expect(nextNavIndex("ArrowLeft", 0, 5, 3)).toBe(4)
  })

  it("ArrowDown / ArrowUp move by one row and clamp", () => {
    expect(nextNavIndex("ArrowDown", 0, 6, 3)).toBe(3)
    expect(nextNavIndex("ArrowDown", 4, 6, 3)).toBe(5) // clamped to last
    expect(nextNavIndex("ArrowUp", 4, 6, 3)).toBe(1)
    expect(nextNavIndex("ArrowUp", 1, 6, 3)).toBe(0) // clamped to first
  })

  it("Home / End jump to the edges", () => {
    expect(nextNavIndex("Home", 3, 6, 3)).toBe(0)
    expect(nextNavIndex("End", 0, 6, 3)).toBe(5)
  })

  it("returns null for non-navigation keys and empty lists", () => {
    expect(nextNavIndex("a", 0, 6, 3)).toBeNull()
    expect(nextNavIndex("ArrowRight", 0, 0, 1)).toBeNull()
  })
})

describe("estimateGridCols", () => {
  function fakeEl(top: number): HTMLElement {
    const el = document.createElement("button")
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ top } as DOMRect)
    return el
  }

  it("counts items sharing the first row's Y coordinate", () => {
    const els = [fakeEl(0), fakeEl(0), fakeEl(0), fakeEl(80), fakeEl(80)]
    expect(estimateGridCols(els)).toBe(3)
  })

  it("single item → 1 column", () => {
    expect(estimateGridCols([fakeEl(0)])).toBe(1)
  })
})

// ----------------------------------------------------- DimensionTileGrid ----

const ENTRIES: DimensionEntry[] = [
  { id: "a", label: "Alpha", description: "first" },
  { id: "b", label: "Beta", description: "second" },
  { id: "c", label: "Gamma", description: "third" },
]

function renderGrid(props: Partial<Parameters<typeof DimensionTileGrid>[0]> = {}, commit?: () => void) {
  const onChange = vi.fn()
  const ui = (
    <DimensionTileGrid
      entries={ENTRIES}
      value={undefined}
      onChange={onChange}
      renderIcon={() => <span />}
      {...props}
    />
  )
  render(commit ? <TileCommitContext.Provider value={{ commit }}>{ui}</TileCommitContext.Provider> : ui)
  return { onChange }
}

function tile(label: string): HTMLElement {
  return screen.getByRole("radio", { name: label })
}

describe("DimensionTileGrid keyboard", () => {
  it("ArrowRight moves focus to the next tile; ArrowLeft wraps", () => {
    renderGrid()
    tile("Alpha").focus()
    fireEvent.keyDown(tile("Alpha"), { key: "ArrowRight" })
    expect(document.activeElement).toBe(tile("Beta"))
    fireEvent.keyDown(tile("Beta"), { key: "ArrowLeft" })
    expect(document.activeElement).toBe(tile("Alpha"))
    fireEvent.keyDown(tile("Alpha"), { key: "ArrowLeft" })
    expect(document.activeElement).toBe(tile("Gamma"))
  })

  it("Home / End jump to first / last tile", () => {
    renderGrid()
    tile("Beta").focus()
    fireEvent.keyDown(tile("Beta"), { key: "End" })
    expect(document.activeElement).toBe(tile("Gamma"))
    fireEvent.keyDown(tile("Gamma"), { key: "Home" })
    expect(document.activeElement).toBe(tile("Alpha"))
  })

  it("Enter single-selects the focused tile", () => {
    const { onChange } = renderGrid()
    tile("Beta").focus()
    fireEvent.keyDown(tile("Beta"), { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith("b")
  })

  it("Enter on an already-selected tile commits (closes the fullscreen host)", () => {
    const commit = vi.fn()
    const { onChange } = renderGrid({ value: "b" }, commit)
    tile("Beta").focus()
    fireEvent.keyDown(tile("Beta"), { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith("b")
    expect(commit).toHaveBeenCalled()
  })

  it("Space adds to the multi-pick when maxSelected > 1", () => {
    const onChange = vi.fn()
    render(
      <DimensionTileGrid
        entries={ENTRIES}
        value={["a"]}
        onChange={onChange}
        renderIcon={() => <span />}
        maxSelected={3}
      />,
    )
    const beta = screen.getByRole("checkbox", { name: "Beta" })
    beta.focus()
    fireEvent.keyDown(beta, { key: " " })
    expect(onChange).toHaveBeenCalledWith(["a", "b"])
  })

  it("ArrowDown from the search input focuses the first tile", () => {
    renderGrid()
    const search = screen.getByRole("textbox")
    search.focus()
    fireEvent.keyDown(search, { key: "ArrowDown" })
    expect(document.activeElement).toBe(tile("Alpha"))
  })

  it("modified arrows (Alt+Arrow canvas navigation) are not swallowed", () => {
    renderGrid()
    tile("Alpha").focus()
    fireEvent.keyDown(tile("Alpha"), { key: "ArrowRight", altKey: true })
    expect(document.activeElement).toBe(tile("Alpha"))
  })
})

// ----------------------------------------- delegated panel-body handler ----

function PanelHarness({ onTab }: { readonly onTab: (id: string) => void }) {
  return (
    <div data-config-panel-body="true" onKeyDown={handleConfigPanelNavKeyDown}>
      <div role="tablist" aria-label="Groups">
        <button type="button" role="tab" aria-selected="true" onClick={() => onTab("one")}>One</button>
        <button type="button" role="tab" aria-selected="false" onClick={() => onTab("two")}>Two</button>
        <button type="button" role="tab" aria-selected="false" onClick={() => onTab("three")}>Three</button>
      </div>
      <div role="radiogroup" aria-label="Ratio">
        <button type="button" role="radio" aria-checked="true">1:1</button>
        <button type="button" role="radio" aria-checked="false">16:9</button>
      </div>
    </div>
  )
}

describe("handleConfigPanelNavKeyDown (delegated)", () => {
  it("ArrowRight on a tab focuses AND activates the next tab", () => {
    const onTab = vi.fn()
    render(<PanelHarness onTab={onTab} />)
    const one = screen.getByRole("tab", { name: "One" })
    one.focus()
    fireEvent.keyDown(one, { key: "ArrowRight" })
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Two" }))
    expect(onTab).toHaveBeenCalledWith("two")
  })

  it("ArrowLeft on the first tab wraps to the last", () => {
    const onTab = vi.fn()
    render(<PanelHarness onTab={onTab} />)
    const one = screen.getByRole("tab", { name: "One" })
    one.focus()
    fireEvent.keyDown(one, { key: "ArrowLeft" })
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Three" }))
    expect(onTab).toHaveBeenCalledWith("three")
  })

  it("arrows on radiogroup tiles move focus WITHOUT activating", () => {
    const onTab = vi.fn()
    render(<PanelHarness onTab={onTab} />)
    const square = screen.getByRole("radio", { name: "1:1" })
    square.focus()
    fireEvent.keyDown(square, { key: "ArrowRight" })
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "16:9" }))
    expect(onTab).not.toHaveBeenCalled()
  })

  it("ignores keys originating inside a data-picker-grid (grid self-handles)", () => {
    render(
      <div data-config-panel-body="true" onKeyDown={handleConfigPanelNavKeyDown}>
        <div role="radiogroup" data-picker-grid="true">
          <button type="button" role="radio" aria-checked="false">A</button>
          <button type="button" role="radio" aria-checked="false">B</button>
        </div>
      </div>,
    )
    const a = screen.getByRole("radio", { name: "A" })
    a.focus()
    fireEvent.keyDown(a, { key: "ArrowRight" })
    expect(document.activeElement).toBe(a) // delegate left it alone
  })
})

// ------------------------------------------------------ roving tabindex ----

describe("roving tabindex (Tab jumps between sections)", () => {
  it("each composite section exposes exactly one Tab stop", () => {
    render(
      <div data-testid="body">
        <div role="tablist">
          <button type="button" role="tab" aria-selected="false">T1</button>
          <button type="button" role="tab" aria-selected="true">T2</button>
        </div>
        <div role="radiogroup">
          <button type="button" role="radio" aria-checked="false">R1</button>
          <button type="button" role="radio" aria-checked="false">R2</button>
          <button type="button" role="radio" aria-checked="true">R3</button>
        </div>
      </div>,
    )
    applyRovingTabIndex(screen.getByTestId("body"))
    // Selected/checked member is the tab stop; the rest are skipped by Tab.
    expect(screen.getByRole("tab", { name: "T2" }).tabIndex).toBe(0)
    expect(screen.getByRole("tab", { name: "T1" }).tabIndex).toBe(-1)
    expect(screen.getByRole("radio", { name: "R3" }).tabIndex).toBe(0)
    expect(screen.getByRole("radio", { name: "R1" }).tabIndex).toBe(-1)
    expect(screen.getByRole("radio", { name: "R2" }).tabIndex).toBe(-1)
  })

  it("falls back to the first member when nothing is selected", () => {
    render(
      <div data-testid="body">
        <div role="radiogroup">
          <button type="button" role="radio" aria-checked="false">A</button>
          <button type="button" role="radio" aria-checked="false">B</button>
        </div>
      </div>,
    )
    applyRovingTabIndex(screen.getByTestId("body"))
    expect(screen.getByRole("radio", { name: "A" }).tabIndex).toBe(0)
    expect(screen.getByRole("radio", { name: "B" }).tabIndex).toBe(-1)
  })

  it("the tab stop follows keyboard focus (focusin)", () => {
    render(
      <div data-testid="body">
        <div role="radiogroup">
          <button type="button" role="radio" aria-checked="false">A</button>
          <button type="button" role="radio" aria-checked="false">B</button>
        </div>
      </div>,
    )
    const attach = createRovingTabIndexRef()
    attach(screen.getByTestId("body"))
    const b = screen.getByRole("radio", { name: "B" })
    b.focus() // fires focusin
    expect(b.tabIndex).toBe(0)
    expect(screen.getByRole("radio", { name: "A" }).tabIndex).toBe(-1)
    attach(null) // detach cleanly
  })

  it("a real DimensionTileGrid becomes a single Tab stop", () => {
    const { onChange } = renderGrid()
    applyRovingTabIndex(document.body)
    const stops = [tile("Alpha"), tile("Beta"), tile("Gamma")].map((t) => t.tabIndex)
    expect(stops.filter((t) => t === 0)).toHaveLength(1)
    expect(onChange).not.toHaveBeenCalled()
  })
})

// ------------------------------------- real picker markup (PersonPicker) ----

describe("delegated nav against real picker markup", () => {
  it("ArrowRight on a real group tab focuses and activates the next group", () => {
    render(
      <div data-config-panel-body="true" onKeyDown={handleConfigPanelNavKeyDown}>
        <PersonPickerDetailed value={{ ethnicity: "chinese" }} onChange={() => {}} />
      </div>,
    )
    const tablist = screen.getByRole("tablist", { name: /type groups/i })
    const tabs = within(tablist).getAllByRole("tab")
    expect(tabs.length).toBeGreaterThan(1)
    expect(tabs[0]).toHaveAttribute("aria-selected", "true")

    tabs[0].focus()
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" })

    // Activation follows focus: the second tab is now focused AND selected.
    const tabsAfter = within(screen.getByRole("tablist", { name: /type groups/i })).getAllByRole("tab")
    expect(document.activeElement).toBe(tabsAfter[1])
    expect(tabsAfter[1]).toHaveAttribute("aria-selected", "true")
    expect(tabsAfter[0]).toHaveAttribute("aria-selected", "false")
  })

  it("arrows rove across real tile buttons without selecting", () => {
    const onChange = vi.fn()
    render(
      <div data-config-panel-body="true" onKeyDown={handleConfigPanelNavKeyDown}>
        <PersonPickerDetailed value={{ frame: "frame-slim" }} onChange={onChange} />
      </div>,
    )
    // Frame is an ungrouped single-pick dimension → role="radio" tiles.
    const slim = screen.getByRole("radio", { name: /^Slim$/i })
    slim.focus()
    fireEvent.keyDown(slim, { key: "ArrowRight" })
    expect(document.activeElement).not.toBe(slim)
    expect(document.activeElement?.getAttribute("role")).toBe("radio")
    expect(onChange).not.toHaveBeenCalled()
  })
})
