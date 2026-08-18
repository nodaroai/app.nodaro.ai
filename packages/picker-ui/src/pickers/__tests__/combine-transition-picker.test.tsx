import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CombineTransitionPicker } from "../combine-transition-picker"

describe("CombineTransitionPicker", () => {
  it("opens on Common when value is a Common-flagged transition", () => {
    render(<CombineTransitionPicker value="fade" onChange={() => {}} />)
    expect(screen.getByRole("tab", { name: /^Common$/ })).toHaveAttribute("aria-selected", "true")
  })

  it("opens on the entry's group when value is not Common", () => {
    // `pixelize` is in the Effects group and not flagged common.
    render(<CombineTransitionPicker value="pixelize" onChange={() => {}} />)
    expect(screen.getByRole("tab", { name: /^Effects$/ })).toHaveAttribute("aria-selected", "true")
  })

  it("clicking a tile fires onChange with the catalog id", () => {
    const onChange = vi.fn()
    render(<CombineTransitionPicker value="cut" onChange={onChange} />)
    fireEvent.click(screen.getByRole("radio", { name: /Fade/ }))
    expect(onChange).toHaveBeenCalledWith("fade")
  })

  it("activeTab re-syncs to the new value's group when value changes externally", () => {
    // Reproduces the workflow-load / undo-redo case: parent owns the value;
    // the picker's activeTab must follow even if the user previously clicked
    // a different tab. Without the useEffect this test fails.
    const { rerender } = render(
      <CombineTransitionPicker value="fade" onChange={() => {}} />,
    )
    expect(screen.getByRole("tab", { name: /^Common$/ })).toHaveAttribute("aria-selected", "true")

    rerender(<CombineTransitionPicker value="pixelize" onChange={() => {}} />)
    expect(screen.getByRole("tab", { name: /^Effects$/ })).toHaveAttribute("aria-selected", "true")

    rerender(<CombineTransitionPicker value="circle-close" onChange={() => {}} />)
    expect(screen.getByRole("tab", { name: /^Shapes$/ })).toHaveAttribute("aria-selected", "true")
  })

  it("user clicks an arbitrary tab; activeTab sticks until value changes", () => {
    const { rerender } = render(
      <CombineTransitionPicker value="cut" onChange={() => {}} />,
    )
    fireEvent.click(screen.getByRole("tab", { name: /^Wipes$/ }))
    expect(screen.getByRole("tab", { name: /^Wipes$/ })).toHaveAttribute("aria-selected", "true")

    // Same value → no re-sync.
    rerender(<CombineTransitionPicker value="cut" onChange={() => {}} />)
    expect(screen.getByRole("tab", { name: /^Wipes$/ })).toHaveAttribute("aria-selected", "true")
  })
})
