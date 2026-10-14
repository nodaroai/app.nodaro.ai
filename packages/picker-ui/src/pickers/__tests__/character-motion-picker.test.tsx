import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { CHARACTER_MOTION_CATEGORY_LABELS, CHARACTER_MOTION_CATEGORY_ORDER } from "@nodaro/prompts/pickers"
import { CharacterMotionPicker } from "../character-motion-picker"

// Four moves from the first tab (Entrances & Exits), so no tab switching.
const A = { id: "walk-in-from-left", name: /Walk In From Left/i }
const B = { id: "walk-in-from-right", name: /Walk In From Right/i }
const C = { id: "enter-from-behind-camera", name: /Enter From Behind Camera/i }
const D = { id: "approach-from-background", name: /Approach From Background/i }

describe("CharacterMotionPicker", () => {
  it("renders one tab per category, in catalog order", () => {
    render(<CharacterMotionPicker value={undefined} onValueChange={() => {}} />)
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent)
    expect(tabs).toEqual(CHARACTER_MOTION_CATEGORY_ORDER.map((c) => CHARACTER_MOTION_CATEGORY_LABELS[c]))
  })

  it("defaults to three ordered picks", () => {
    render(<CharacterMotionPicker value={undefined} onValueChange={() => {}} />)
    expect(screen.getByText(/0\s*\/\s*3 selected/)).toBeInTheDocument()
  })

  it("a first click emits the id string", () => {
    const onChange = vi.fn()
    render(<CharacterMotionPicker value={undefined} onValueChange={onChange} />)
    fireEvent.click(screen.getByRole("checkbox", { name: A.name }))
    expect(onChange).toHaveBeenLastCalledWith(A.id)
  })

  it("appends picks in click order and shows the numbered sequence", () => {
    const onChange = vi.fn()
    const { rerender } = render(<CharacterMotionPicker value={[A.id]} onValueChange={onChange} />)
    fireEvent.click(screen.getByRole("checkbox", { name: B.name }))
    expect(onChange).toHaveBeenLastCalledWith([A.id, B.id])

    rerender(<CharacterMotionPicker value={[B.id, A.id]} onValueChange={onChange} />)
    const steps = within(screen.getByRole("list", { name: "Motion sequence" })).getAllByRole("listitem")
    expect(steps[0]).toHaveTextContent("Walk in from right")
    expect(steps[1]).toHaveTextContent("Walk in from left")
  })

  it("at the cap a new pick preserves the existing sequence", () => {
    const onChange = vi.fn()
    render(<CharacterMotionPicker value={[A.id, B.id, C.id]} onValueChange={onChange} />)
    fireEvent.click(screen.getByRole("checkbox", { name: D.name }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it("search flattens across categories and hides the tabs", () => {
    render(<CharacterMotionPicker value={undefined} onValueChange={() => {}} />)
    fireEvent.change(screen.getByLabelText("Search character motion"), { target: { value: "wave hello" } })
    expect(screen.getByRole("checkbox", { name: /Wave Hello/i })).toBeInTheDocument()
    expect(screen.queryAllByRole("tab")).toHaveLength(0)
  })

  it("shows an empty state when nothing matches", () => {
    render(<CharacterMotionPicker value={undefined} onValueChange={() => {}} />)
    fireEvent.change(screen.getByLabelText("Search character motion"), { target: { value: "xyzqq" } })
    expect(screen.getByText(/No moves match/)).toBeInTheDocument()
  })
})

  it("reorders and removes selections without repicking", () => {
    const change = vi.fn()
    render(<CharacterMotionPicker value={[A.id, B.id]} onValueChange={change} />)
    fireEvent.click(screen.getByRole("button", { name: /Move Walk in from right up/i }))
    expect(change).toHaveBeenLastCalledWith([B.id, A.id])
    fireEvent.click(screen.getByRole("button", { name: /Remove Walk in from left/i }))
    expect(change).toHaveBeenLastCalledWith([B.id])
  })
  it("searches former titles and hides deprecated choices unless selected", () => {
    render(<CharacterMotionPicker value={undefined} onValueChange={() => {}} />)
    fireEvent.change(screen.getByLabelText("Search character motion"), { target: { value: "High-Fashion Walk" } })
    expect(screen.getByRole("checkbox", { name: /Walk with rigid arms/i })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Search character motion"), { target: { value: "mount the horse" } })
    expect(screen.queryByRole("checkbox", { name: /Mount the horse/i })).not.toBeInTheDocument()
  })
