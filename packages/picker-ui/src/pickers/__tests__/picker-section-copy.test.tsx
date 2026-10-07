import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import {
  COLOR_LOOK_CATEGORY_LABELS,
  COLOR_LOOK_CATEGORY_ORDER,
  LIGHTING_CATEGORY_LABELS,
  LIGHTING_CATEGORY_ORDER,
  LOOP_SUBJECT_CATEGORY_LABELS,
  LOOP_SUBJECT_CATEGORY_ORDER,
} from "@nodaro/prompts"
import { LightingPicker, LIGHTING_PICKER_COPY_EN, type LightingPickerCopy } from "../lighting-picker"
import { LoopSubjectPicker, LOOP_SUBJECT_PICKER_COPY_EN } from "../loop-subject-picker"
import { ColorLookPicker, COLOR_LOOK_PICKER_COPY_EN } from "../color-look-picker"
import type { PickerSearchCopy } from "../picker-copy"

/**
 * The Lighting, Loop Subject and Color/Look pickers own no dictionary: the host
 * passes their interface strings (`copy`) and a localizer for the catalog's
 * section names (`localizeLabel`). Both default to English.
 */
const localizeXX = (english: string) => `xx:${english}`
const SEARCH_XX: PickerSearchCopy = {
  searchPlaceholder: "xx-search",
  noMatch: (query) => `xx nothing for ${query}`,
}
const LIGHTING_XX: LightingPickerCopy = {
  ...SEARCH_XX,
  pickUpTo: (n) => `xx up to ${n}`,
  sectionPickUpTo: (section, n) => `${section} xx up to ${n}`,
  enableSection: (section) => `xx enable ${section}`,
  clickToEnable: (description, section) => `${description} xx click ${section}`,
}

describe("LightingPicker section names and strings", () => {
  it("renders English when the host passes no copy and no localizer", () => {
    render(<LightingPicker value={{}} onChange={() => {}} />)
    expect(screen.getByPlaceholderText(LIGHTING_PICKER_COPY_EN.searchPlaceholder)).toBeTruthy()
    for (const cat of LIGHTING_CATEGORY_ORDER) {
      expect(screen.getByRole("switch", { name: `Enable ${LIGHTING_CATEGORY_LABELS[cat]}` })).toBeTruthy()
    }
  })

  it("names every section, switch and multi-pick hint through localizeLabel and copy", () => {
    render(<LightingPicker value={{ lightingStyle: ["rembrandt"] }} onChange={() => {}} localizeLabel={localizeXX} copy={LIGHTING_XX} />)
    for (const cat of LIGHTING_CATEGORY_ORDER) {
      const section = `xx:${LIGHTING_CATEGORY_LABELS[cat]}`
      expect(screen.getByRole("switch", { name: `xx enable ${section}` })).toBeTruthy()
    }
    // Style is the multi-pick section (up to 2) and is on: its hint and grid name.
    expect(screen.getByText("xx up to 2")).toBeTruthy()
    expect(screen.getByRole("group", { name: `xx:${LIGHTING_CATEGORY_LABELS.style} xx up to 2` })).toBeTruthy()
    // A switched-off section's tiles say how to switch it on, in the host's words.
    const offSection = screen.getByRole("radiogroup", { name: `xx:${LIGHTING_CATEGORY_LABELS["time-of-day"]}` })
    expect(offSection.querySelector("button[title]")?.getAttribute("title")).toMatch(new RegExp(`xx click xx:${LIGHTING_CATEGORY_LABELS["time-of-day"]}$`))
  })

  it("shows the empty state from copy", () => {
    render(<LightingPicker value={{}} onChange={() => {}} localizeLabel={localizeXX} copy={LIGHTING_XX} />)
    fireEvent.change(screen.getByRole("textbox", { name: "xx-search" }), { target: { value: "zzzz-no-such-light" } })
    expect(screen.getByText("xx nothing for zzzz-no-such-light")).toBeTruthy()
  })
})

describe("LoopSubjectPicker group names and strings", () => {
  it("renders English when the host passes no copy and no localizer", () => {
    render(<LoopSubjectPicker value="tunnel" onValueChange={() => {}} />)
    expect(screen.getByPlaceholderText(LOOP_SUBJECT_PICKER_COPY_EN.searchPlaceholder)).toBeTruthy()
    for (const cat of LOOP_SUBJECT_CATEGORY_ORDER) {
      expect(screen.getByRole("radiogroup", { name: LOOP_SUBJECT_CATEGORY_LABELS[cat] })).toBeTruthy()
    }
  })

  it("names every group through localizeLabel and shows copy's strings", () => {
    render(<LoopSubjectPicker value="tunnel" onValueChange={() => {}} localizeLabel={localizeXX} copy={SEARCH_XX} />)
    for (const cat of LOOP_SUBJECT_CATEGORY_ORDER) {
      const group = `xx:${LOOP_SUBJECT_CATEGORY_LABELS[cat]}`
      expect(screen.getByRole("radiogroup", { name: group })).toBeTruthy()
      expect(screen.getByText(group)).toBeTruthy()
    }
    fireEvent.change(screen.getByRole("textbox", { name: "xx-search" }), { target: { value: "zzzz-no-such-subject" } })
    expect(screen.getByText("xx nothing for zzzz-no-such-subject")).toBeTruthy()
  })
})

describe("ColorLookPicker section names and strings", () => {
  it("renders English when the host passes no copy and no localizer", () => {
    render(<ColorLookPicker value="warm" onValueChange={() => {}} />)
    expect(screen.getByPlaceholderText(COLOR_LOOK_PICKER_COPY_EN.searchPlaceholder)).toBeTruthy()
    for (const cat of COLOR_LOOK_CATEGORY_ORDER) {
      expect(screen.getByRole("radiogroup", { name: COLOR_LOOK_CATEGORY_LABELS[cat] })).toBeTruthy()
    }
  })

  it("names every section through localizeLabel and shows copy's strings", () => {
    render(<ColorLookPicker value="warm" onValueChange={() => {}} localizeLabel={localizeXX} copy={SEARCH_XX} />)
    for (const cat of COLOR_LOOK_CATEGORY_ORDER) {
      const section = `xx:${COLOR_LOOK_CATEGORY_LABELS[cat]}`
      expect(screen.getByRole("radiogroup", { name: section })).toBeTruthy()
      expect(screen.getByText(section)).toBeTruthy()
    }
    fireEvent.change(screen.getByRole("textbox", { name: "xx-search" }), { target: { value: "zzzz-no-such-look" } })
    expect(screen.getByText("xx nothing for zzzz-no-such-look")).toBeTruthy()
  })
})
