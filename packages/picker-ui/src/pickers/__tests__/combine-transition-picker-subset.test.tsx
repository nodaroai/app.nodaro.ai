// The restricted form of the combine-transition picker (SV1): Speaker View's
// crossfade popover offers only the `xfade:*` family. The original picker's own
// tests live beside this file and stay untouched: they are the guard that the
// default props draw the picker exactly as before.
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CombineTransitionPicker, TransitionTile } from "../combine-transition-picker"

const FADES = ["fade", "fadeblack", "wipe-left"]

describe("CombineTransitionPicker restricted to a subset", () => {
  it("lists only the allowed transitions, and no tab that would be empty", () => {
    render(<CombineTransitionPicker value="fade" onChange={() => {}} allowedIds={FADES} />)
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent?.trim())
    expect(tabs).toContain("Wipes")
    expect(tabs).not.toContain("Effects")
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(0)
    expect(screen.queryByRole("radio", { name: /Pixelize/ })).toBeNull()
  })

  it("never offers an id outside the allowed set, on any tab", () => {
    render(<CombineTransitionPicker value="fade" onChange={() => {}} allowedIds={["fade", "wipe-left"]} />)
    const seen = new Set<string>()
    for (const tab of screen.getAllByRole("tab")) {
      fireEvent.click(tab)
      for (const tile of screen.queryAllByRole("radio")) seen.add(tile.querySelector(".ct-tile-label")?.textContent ?? "")
    }
    expect([...seen].sort()).toEqual(["Fade", "Wipe Left"])
  })

  it("picking a tile still reports the catalog id", () => {
    const onChange = vi.fn()
    render(<CombineTransitionPicker value="fade" onChange={onChange} allowedIds={FADES} />)
    fireEvent.click(screen.getByRole("tab", { name: /^Wipes$/ }))
    fireEvent.click(screen.getByRole("radio", { name: /Wipe Left/ }))
    expect(onChange).toHaveBeenCalledWith("wipe-left")
  })

  it("opens on a tab that has tiles when the value is not allowed", () => {
    render(<CombineTransitionPicker value="pixelize" onChange={() => {}} allowedIds={FADES} />)
    const selected = screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true")
    expect(selected).toHaveLength(1)
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(0)
  })

  it("renders leading tiles in a group above the tabs", () => {
    render(
      <CombineTransitionPicker
        value="fade"
        onChange={() => {}}
        allowedIds={FADES}
        leadingTiles={<button type="button" role="radio" aria-checked={false}>Lead</button>}
      />,
    )
    const lead = screen.getByRole("radio", { name: "Lead" })
    const firstTab = screen.getAllByRole("tab")[0]!
    expect(lead.compareDocumentPosition(firstTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("shows no extra group when there are no leading tiles", () => {
    const { container } = render(<CombineTransitionPicker value="fade" onChange={() => {}} />)
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(0)
  })

  it("exports the tile so a host can draw its own beside the catalog's", () => {
    expect(typeof TransitionTile).toBe("function")
  })
})
