import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TRANSITION_CATEGORY_LABELS, TRANSITION_CATEGORY_ORDER } from "@nodaro/prompts"
import { TransitionPicker, TRANSITION_PICKER_COPY_EN, type TransitionPickerCopy } from "../transition-picker"

/**
 * The picker owns no dictionary: the host passes its interface strings
 * (`copy`) and a localizer for the catalog's category names
 * (`localizeLabel`). Both default to English so a host that passes neither
 * renders what the picker always rendered.
 */
const COPY_XX: TransitionPickerCopy = {
  searchPlaceholder: "xx-search",
  searchResults: "xx-results",
  categories: "xx-categories",
  selectedCount: (n, max) => `xx ${n} of ${max}`,
  categorySelectedCount: (n) => `xx ${n} picked`,
  noMatch: (query) => `xx nothing for ${query}`,
}
const localizeXX = (english: string) => `xx:${english}`

describe("TransitionPicker", () => {
  it("renders English when the host passes no copy and no localizer", () => {
    render(<TransitionPicker value={undefined} onValueChange={() => {}} />)
    expect(screen.getByRole("tablist", { name: TRANSITION_PICKER_COPY_EN.categories })).toBeInTheDocument()
    for (const cat of TRANSITION_CATEGORY_ORDER) {
      expect(screen.getByRole("tab", { name: TRANSITION_CATEGORY_LABELS[cat] })).toBeInTheDocument()
    }
    expect(screen.getByPlaceholderText("Search transitions…")).toBeInTheDocument()
    expect(screen.getByText("0 / 2 selected")).toBeInTheDocument()
  })

  it("renders every category tab and the active grid through localizeLabel", () => {
    render(<TransitionPicker value={undefined} onValueChange={() => {}} localizeLabel={localizeXX} copy={COPY_XX} />)
    for (const cat of TRANSITION_CATEGORY_ORDER) {
      expect(screen.getByRole("tab", { name: `xx:${TRANSITION_CATEGORY_LABELS[cat]}` })).toBeInTheDocument()
    }
    expect(screen.getByRole("group", { name: `xx:${TRANSITION_CATEGORY_LABELS.standard}` })).toBeInTheDocument()
    expect(screen.getByRole("tablist", { name: "xx-categories" })).toBeInTheDocument()
  })

  it("renders the search box, the counters and the empty state from copy", () => {
    render(<TransitionPicker value={["wipe"]} onValueChange={() => {}} localizeLabel={localizeXX} copy={COPY_XX} />)
    const search = screen.getByRole("textbox", { name: "xx-search" })
    expect(search).toHaveAttribute("placeholder", "xx-search")
    expect(screen.getByText("xx 1 of 2")).toBeInTheDocument()
    expect(screen.getByLabelText("xx 1 picked")).toBeInTheDocument()

    fireEvent.change(search, { target: { value: "wipe" } })
    expect(screen.getByRole("group", { name: "xx-results" })).toBeInTheDocument()

    fireEvent.change(search, { target: { value: "zzzz-no-such-transition" } })
    expect(screen.getByText("xx nothing for zzzz-no-such-transition")).toBeInTheDocument()
  })

  it("still reports picks through onValueChange", () => {
    const onChange = vi.fn()
    render(<TransitionPicker value={undefined} onValueChange={onChange} localizeLabel={localizeXX} copy={COPY_XX} />)
    fireEvent.click(screen.getByRole("checkbox", { name: /Cross-Dissolve/ }))
    expect(onChange).toHaveBeenCalledWith("cross-dissolve")
  })
})
