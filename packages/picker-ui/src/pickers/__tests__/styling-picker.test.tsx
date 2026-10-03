import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import type { StylingValue } from "@nodaro/prompts"
import { StylingPicker } from "../styling-picker"
import { STYLING_TOPICS } from "../styling-topics"

// Renders every setting of every topic — heavy in jsdom.
vi.setConfig({ testTimeout: 15000 })

afterEach(() => {
  vi.restoreAllMocks()
})

function renderPicker(value: StylingValue = {}) {
  const onChange = vi.fn()
  render(<StylingPicker value={value} onChange={onChange} />)
  return onChange
}

describe("StylingPicker — open by topic", () => {
  it("lays every topic out open under its heading, with a jump button per topic", () => {
    renderPicker()
    const nav = screen.getByRole("navigation", { name: /Styling topics/i })
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(STYLING_TOPICS.map((t) => t.label))
    for (const topic of STYLING_TOPICS) {
      const section = screen.getByRole("region", { name: topic.label })
      expect(within(section).getByRole("heading", { name: topic.label })).toBeInTheDocument()
    }
    expect(within(screen.getByRole("region", { name: "Accessories" })).getByRole("switch", { name: /Enable Jewelry/i })).toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Wardrobe" })).getByRole("switch", { name: /Enable Footwear/i })).toBeInTheDocument()
  })

  it("a jump button scrolls to its topic", () => {
    const scrolled: Element[] = []
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      scrolled.push(this)
    })
    renderPicker()
    fireEvent.click(within(screen.getByRole("navigation", { name: /Styling topics/i })).getByRole("button", { name: /^Wardrobe/ }))
    expect(scrolled).toEqual([screen.getByRole("region", { name: "Wardrobe" })])
  })

  it("picks a single-pick option as a scalar", () => {
    const onChange = renderPicker()
    const outfits = screen.getByRole("radiogroup", { name: /^Outfit$/ })
    const tile = within(outfits).getAllByRole("radio")[0]
    fireEvent.click(tile)
    expect(onChange).toHaveBeenCalledWith({ outfit: expect.any(String) })
  })

  it("the enable switch of a single-pick setting picks its first option; off clears it", () => {
    const onChange = renderPicker({ outfit: "outfit-streetwear" })
    fireEvent.click(screen.getByRole("switch", { name: /Enable Outfit/i }))
    expect(onChange).toHaveBeenLastCalledWith({ outfit: undefined })
  })

  it("a multi-pick setting in multi mode toggles ids in an array", () => {
    const onChange = renderPicker({ jewelry: ["jewelry-gold"] })
    const jewelry = screen.getByRole("group", { name: /^Jewelry \(pick up to 3\)$/ })
    const silver = within(jewelry).getByRole("checkbox", { name: /^Silver/i })
    fireEvent.click(silver)
    expect(onChange).toHaveBeenCalledWith({ jewelry: ["jewelry-gold", "jewelry-silver"] })
  })

  it("counts the picked settings of each topic", () => {
    renderPicker({ outfit: "outfit-streetwear", footwear: "footwear-sneakers" })
    expect(within(screen.getByRole("region", { name: "Wardrobe" })).getByText("2 picked")).toBeInTheDocument()
  })

  it("search looks across every topic and keeps only the matching settings", () => {
    renderPicker()
    fireEvent.change(screen.getByRole("textbox", { name: /Search styling/i }), { target: { value: "sneakers" } })
    expect(screen.queryByRole("navigation", { name: /Styling topics/i })).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Wardrobe" })).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Accessories" })).not.toBeInTheDocument()
  })
})
