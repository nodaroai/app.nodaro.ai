import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ActionFxPicker } from "../action-fx-picker"

describe("ActionFxPicker", () => {
  it("renders all 6 category tab triggers", () => {
    render(<ActionFxPicker value={undefined} onValueChange={() => {}} />)
    expect(screen.getByRole("tab", { name: "Disaster" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Fire & Blasts" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Electric" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Combat" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Sci-Fi" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Magic" })).toBeInTheDocument()
  })

  it("clicking a tile in single mode calls onValueChange with the id string", () => {
    const onChange = vi.fn()
    render(<ActionFxPicker value={undefined} onValueChange={onChange} />)
    // Default tab is "disaster" — Major Earthquake is in that group.
    const tile = screen.getByRole("checkbox", { name: /Major Earthquake/i })
    fireEvent.click(tile)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith("earthquake-major")
  })

  it("toggles into multi-pick mode via the + badge then accepts a second pick", () => {
    const onChange = vi.fn()
    // Start in single mode with one selected so the + badge is visible.
    const { rerender } = render(
      <ActionFxPicker value="earthquake-major" onValueChange={onChange} />,
    )
    // The + badge is rendered as a sibling button on the selected tile.
    fireEvent.click(screen.getByRole("button", { name: /activate multi-select/i }))
    expect(onChange).toHaveBeenLastCalledWith(["earthquake-major"])

    // Re-render in multi mode and ensure a second pick produces a 2-element array.
    rerender(<ActionFxPicker value={["earthquake-major"]} onValueChange={onChange} />)
    fireEvent.click(screen.getByRole("checkbox", { name: /Building Collapse/i }))
    expect(onChange).toHaveBeenLastCalledWith(["earthquake-major", "building-collapse"])
  })

  it("search flattens across categories — Lightning Bolt is in 'electric' but visible while default tab is 'disaster'", () => {
    render(<ActionFxPicker value={undefined} onValueChange={() => {}} />)
    const search = screen.getByLabelText("Search action FX")
    fireEvent.change(search, { target: { value: "lightning bolt" } })
    expect(screen.getByRole("checkbox", { name: /Lightning Bolt/i })).toBeInTheDocument()
    // Tabs should be hidden while searching.
    expect(screen.queryByRole("tab", { name: "Disaster" })).not.toBeInTheDocument()
  })

  it("shows empty state when search has no matches", () => {
    render(<ActionFxPicker value={undefined} onValueChange={() => {}} />)
    const search = screen.getByLabelText("Search action FX")
    fireEvent.change(search, { target: { value: "xyzqq" } })
    expect(screen.getByText(/No FX matches/)).toBeInTheDocument()
  })

  it("displays selection counter (selected / max)", () => {
    render(
      <ActionFxPicker
        value={["lightning-bolt", "fireball-spell"]}
        onValueChange={() => {}}
        maxSelected={2}
      />,
    )
    expect(screen.getByText(/2\s*\/\s*2 selected/)).toBeInTheDocument()
  })

  it("at cap (maxSelected reached), clicks honour the cap — selection length never exceeds max", () => {
    const onChange = vi.fn()
    // Two distinct disaster-category ids so they're both visible on default tab.
    render(
      <ActionFxPicker
        value={["earthquake-major", "building-collapse"]}
        onValueChange={onChange}
        maxSelected={2}
      />,
    )
    const unpicked = screen.getByRole("checkbox", { name: /Tsunami Wave/i })
    fireEvent.click(unpicked)
    // togglePick at-cap: either no-op (no call) OR an array of length ≤ maxSelected
    // (FIFO eviction is allowed; growing past the cap is not).
    for (const call of onChange.mock.calls) {
      const arg = call[0]
      if (Array.isArray(arg)) {
        expect(arg.length).toBeLessThanOrEqual(2)
      }
    }
  })

  it("switching tabs changes which tiles are visible", async () => {
    const user = userEvent.setup()
    render(<ActionFxPicker value={undefined} onValueChange={() => {}} />)
    // Default: disaster tab — Major Earthquake visible, Lightning Bolt not.
    expect(screen.queryByRole("checkbox", { name: /Major Earthquake/i })).toBeInTheDocument()
    expect(screen.queryByRole("checkbox", { name: /Lightning Bolt/i })).not.toBeInTheDocument()

    // Radix Tabs.Trigger reacts to pointerdown — userEvent.click fires the
    // full pointer sequence (pointerdown + click). Plain fireEvent.click is
    // not enough.
    await user.click(screen.getByRole("tab", { name: "Electric" }))

    expect(screen.queryByRole("checkbox", { name: /Lightning Bolt/i })).toBeInTheDocument()
    expect(screen.queryByRole("checkbox", { name: /Major Earthquake/i })).not.toBeInTheDocument()
  })

  it("uses radio role tiles when maxSelected={1}", () => {
    render(
      <ActionFxPicker value={undefined} onValueChange={() => {}} maxSelected={1} />,
    )
    // No checkbox tiles — single-pick mode uses radio.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(0)
    // Counter shows /1.
    expect(screen.getByText(/0\s*\/\s*1 selected/)).toBeInTheDocument()
  })

  it("all tiles within the active tab live in a group labelled by the category", () => {
    render(<ActionFxPicker value={undefined} onValueChange={() => {}} />)
    const group = screen.getByRole("group", { name: "Disaster" })
    // Sanity-check that Major Earthquake is inside the group.
    expect(within(group).getByRole("checkbox", { name: /Major Earthquake/i })).toBeInTheDocument()
  })
})
