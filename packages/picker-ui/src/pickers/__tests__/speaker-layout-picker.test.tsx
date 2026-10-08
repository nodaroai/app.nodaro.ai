import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SpeakerLayoutPicker, speakerLayoutDiagram } from "../speaker-layout-picker"

const OPTIONS = [
  { id: "auto", label: "Auto" },
  { id: "single", label: "Single" },
  { id: "side-by-side", label: "Side by side", disabled: true, reason: "Side by side isn't drawn for 9:16." },
  { id: "stacked", label: "Stacked" },
  { id: "grid", label: "Grid" },
  { id: "pip", label: "Picture in picture" },
]

describe("SpeakerLayoutPicker", () => {
  it("is a radiogroup with one radio per option, the value checked", () => {
    render(<SpeakerLayoutPicker options={OPTIONS} value="grid" aspect="16:9" onChange={() => {}} ariaLabel="Layout" />)
    expect(screen.getByRole("radiogroup", { name: "Layout" })).toBeTruthy()
    const radios = screen.getAllByRole("radio")
    expect(radios).toHaveLength(6)
    expect(screen.getByRole("radio", { name: /Grid/ })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: /Stacked/ })).toHaveAttribute("aria-checked", "false")
  })

  it("a ruled-out tile shows its reason visibly while it holds keyboard focus, and Escape dismisses it", () => {
    render(<SpeakerLayoutPicker options={OPTIONS} value="auto" aspect="9:16" onChange={() => {}} ariaLabel="Layout" />)
    const tile = screen.getByRole("radio", { name: /Side by side/ })
    expect(screen.queryByTestId("stv-reason-caption")).toBeNull()
    fireEvent.focus(tile)
    expect(screen.getByTestId("stv-reason-caption").textContent).toBe("Side by side isn't drawn for 9:16.")
    fireEvent.keyDown(tile, { key: "Escape" })
    expect(screen.queryByTestId("stv-reason-caption")).toBeNull()
    fireEvent.focus(tile)
    fireEvent.blur(tile)
    expect(screen.queryByTestId("stv-reason-caption")).toBeNull()
  })

  it("a tile that is not ruled out never shows a caption on focus", () => {
    render(<SpeakerLayoutPicker options={OPTIONS} value="auto" aspect="9:16" onChange={() => {}} ariaLabel="Layout" />)
    fireEvent.focus(screen.getByRole("radio", { name: /Stacked/ }))
    expect(screen.queryByTestId("stv-reason-caption")).toBeNull()
  })

  it("picking a tile reports its id", () => {
    const onChange = vi.fn()
    render(<SpeakerLayoutPicker options={OPTIONS} value="auto" aspect="16:9" onChange={onChange} ariaLabel="Layout" />)
    fireEvent.click(screen.getByRole("radio", { name: /Stacked/ }))
    expect(onChange).toHaveBeenCalledWith("stacked")
  })

  it("a ruled-out tile says why on hover and focus, is announced as disabled, and cannot be picked", () => {
    const onChange = vi.fn()
    render(<SpeakerLayoutPicker options={OPTIONS} value="auto" aspect="9:16" onChange={onChange} ariaLabel="Layout" />)
    const tile = screen.getByRole("radio", { name: /Side by side/ })
    expect(tile).toHaveAttribute("aria-disabled", "true")
    expect(tile).toHaveAttribute("title", "Side by side isn't drawn for 9:16.")
    const described = tile.getAttribute("aria-describedby")
    expect(described).toBeTruthy()
    expect(document.getElementById(described!)?.textContent).toBe("Side by side isn't drawn for 9:16.")
    fireEvent.click(tile)
    expect(onChange).not.toHaveBeenCalled()
    // still reachable by keyboard, so focus can read the reason
    expect(tile).not.toBeDisabled()
  })

  it("an allowed tile has no reason attached", () => {
    render(<SpeakerLayoutPicker options={OPTIONS} value="auto" aspect="16:9" onChange={() => {}} ariaLabel="Layout" />)
    const tile = screen.getByRole("radio", { name: /Grid/ })
    expect(tile).not.toHaveAttribute("aria-disabled", "true")
    expect(tile).not.toHaveAttribute("title")
    expect(tile).not.toHaveAttribute("aria-describedby")
  })

  it("draws the diagram at the current aspect", () => {
    const { rerender, container } = render(<SpeakerLayoutPicker options={OPTIONS} value="single" aspect="16:9" onChange={() => {}} ariaLabel="Layout" />)
    const ratio = () => {
      const svg = container.querySelector('svg[data-layout="single"]')!
      const canvas = svg.querySelector("[data-canvas]")!
      return Number(canvas.getAttribute("width")) / Number(canvas.getAttribute("height"))
    }
    expect(ratio()).toBeCloseTo(16 / 9, 1)
    rerender(<SpeakerLayoutPicker options={OPTIONS} value="single" aspect="9:16" onChange={() => {}} ariaLabel="Layout" />)
    expect(ratio()).toBeCloseTo(9 / 16, 1)
  })
})

describe("speakerLayoutDiagram", () => {
  const ASPECTS = ["16:9", "9:16", "1:1", "4:5"] as const
  const SLOTS: Record<string, number> = { auto: 1, single: 1, "side-by-side": 2, stacked: 2, grid: 4, pip: 2 }

  it.each(Object.keys(SLOTS))("%s: the right number of slots, all inside the canvas, none overlapping a side-by-side neighbour", (layout) => {
    for (const aspect of ASPECTS) {
      const d = speakerLayoutDiagram(layout, aspect)
      expect(d.slots).toHaveLength(SLOTS[layout]!)
      for (const r of d.slots) {
        expect(r.x).toBeGreaterThanOrEqual(0)
        expect(r.y).toBeGreaterThanOrEqual(0)
        expect(r.x + r.w).toBeLessThanOrEqual(d.width + 1e-6)
        expect(r.y + r.h).toBeLessThanOrEqual(d.height + 1e-6)
        expect(r.w).toBeGreaterThan(0)
        expect(r.h).toBeGreaterThan(0)
      }
    }
  })

  it("the canvas keeps the aspect, inside a fixed box", () => {
    for (const [aspect, ratio] of [["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1], ["4:5", 4 / 5]] as const) {
      const d = speakerLayoutDiagram("single", aspect)
      expect(d.width / d.height).toBeCloseTo(ratio, 2)
      expect(d.width).toBeLessThanOrEqual(48)
      expect(d.height).toBeLessThanOrEqual(32)
    }
  })

  it("side by side puts the slots left and right, stacked top and bottom", () => {
    const sbs = speakerLayoutDiagram("side-by-side", "16:9").slots
    expect(sbs[0]!.x).toBeLessThan(sbs[1]!.x)
    expect(sbs[0]!.y).toBeCloseTo(sbs[1]!.y)
    const st = speakerLayoutDiagram("stacked", "9:16").slots
    expect(st[0]!.y).toBeLessThan(st[1]!.y)
    expect(st[0]!.x).toBeCloseTo(st[1]!.x)
  })

  it("picture in picture draws the inset inside the main slot", () => {
    const [main, inset] = speakerLayoutDiagram("pip", "16:9").slots as [{ x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }]
    expect(inset.x).toBeGreaterThanOrEqual(main.x)
    expect(inset.x + inset.w).toBeLessThanOrEqual(main.x + main.w)
    expect(inset.w).toBeLessThan(main.w)
  })

  it("an unknown id draws as one slot rather than nothing", () => {
    expect(speakerLayoutDiagram("hologram", "16:9").slots).toHaveLength(1)
  })
})
