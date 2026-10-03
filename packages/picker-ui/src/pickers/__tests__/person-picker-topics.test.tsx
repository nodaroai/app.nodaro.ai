import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { PERSON_DIMENSION_SECTIONS, registerPersonPack, resetCatalogPacks, resetPersonPacks } from "@nodaro/prompts"
import { PersonPickerDetailed } from "../person-picker-detailed"
import { PERSON_MORE_TOPIC } from "../person-topics"

// Renders the full open view (every setting of every topic) — heavy in jsdom.
vi.setConfig({ testTimeout: 15000 })

const TOPICS = PERSON_DIMENSION_SECTIONS.map((s) => s.label)

beforeEach(() => {
  resetPersonPacks()
  resetCatalogPacks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("PersonPickerDetailed — open by topic", () => {
  it("lays every topic out open, each under its own heading, with a jump button per topic", () => {
    render(<PersonPickerDetailed value={{}} onChange={() => {}} />)
    const nav = screen.getByRole("navigation", { name: /Person topics/i })
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(TOPICS)
    for (const topic of TOPICS) {
      const section = screen.getByRole("region", { name: topic })
      expect(within(section).getByRole("heading", { name: topic })).toBeInTheDocument()
    }
    // Settings of different topics are all on screen at once — nothing folded.
    expect(screen.getByRole("switch", { name: /Enable Type/i })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: /Enable Jawline/i })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: /Enable Facial Hair/i })).toBeInTheDocument()
  })

  it("a jump button scrolls to its topic", () => {
    const scrolled: Element[] = []
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      scrolled.push(this)
    })
    render(<PersonPickerDetailed value={{}} onChange={() => {}} />)
    const nav = screen.getByRole("navigation", { name: /Person topics/i })
    fireEvent.click(within(nav).getByRole("button", { name: /^Face/ }))
    expect(scrolled).toEqual([screen.getByRole("region", { name: "Face" })])
  })

  it("counts the picked settings of each topic", () => {
    render(<PersonPickerDetailed value={{ faceShape: "face-round", jawline: "jaw-soft" }} onChange={() => {}} />)
    const face = screen.getByRole("region", { name: "Face" })
    expect(within(face).getByText("2 picked")).toBeInTheDocument()
    const nav = screen.getByRole("navigation", { name: /Person topics/i })
    expect(within(nav).getByRole("button", { name: /^Face/ }).textContent).toContain("2")
  })

  it("search looks across every topic and keeps only the matching settings", () => {
    render(<PersonPickerDetailed value={{}} onChange={() => {}} />)
    // "Hourglass" is only a Silhouette option (Body topic).
    fireEvent.change(screen.getByRole("textbox", { name: /Search person/i }), { target: { value: "Hourglass" } })
    expect(screen.queryByRole("navigation", { name: /Person topics/i })).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Body" })).toBeInTheDocument()
    for (const other of TOPICS.filter((t) => t !== "Body")) {
      expect(screen.queryByRole("region", { name: other })).not.toBeInTheDocument()
    }
    expect(screen.getByRole("radio", { name: /^Hourglass$/i })).toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: /^Petite$/i })).not.toBeInTheDocument()
  })

  it("a pack dimension no section lists gets a trailing More topic", () => {
    registerPersonPack({
      id: "test/pack",
      dimensions: [{ dimension: "sector-attire", field: "sectorAttire", label: "Sector Attire" }],
      entries: [
        { id: "attire-modest-suit", label: "Modest Suit", group: "Attire", dimension: "sector-attire", description: "d", promptHint: "h" },
      ],
    })
    render(<PersonPickerDetailed value={{}} onChange={() => {}} />)
    const more = screen.getByRole("region", { name: PERSON_MORE_TOPIC })
    expect(within(more).getByText("Modest Suit")).toBeInTheDocument()
  })
})
