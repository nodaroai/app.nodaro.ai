import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { PickerFieldRestrictionsProvider } from "../../lib/field-restrictions"
import { PersonPickerDetailed } from "../person-picker-detailed"
import { DimensionTileGrid } from "../dimension-tile-grid"

// The detailed person view is large; person-picker.test.tsx explains why 5s is too tight.
vi.setConfig({ testTimeout: 15000 })

const ageTiles = () => within(screen.getByRole("radiogroup", { name: /^Age$/ })).getAllByRole("radio").map((el) => el.getAttribute("data-entry-id") ?? el.textContent)

function renderPerson(allowedByField?: Record<string, string[]>) {
  return render(
    <PickerFieldRestrictionsProvider allowedByField={allowedByField}>
      <PersonPickerDetailed value={{}} onChange={() => {}} />
    </PickerFieldRestrictionsProvider>,
  )
}

describe("per-field restrictions on a multi-dimension picker card", () => {
  it("shows every age tile with no provider (today's behaviour)", () => {
    render(<PersonPickerDetailed value={{}} onChange={() => {}} />)
    expect(ageTiles().length).toBeGreaterThan(8)
  })

  it("shows exactly the allowed age tiles", () => {
    renderPerson({ age: ["age-20s", "age-30s"] })
    expect(ageTiles()).toHaveLength(2)
    expect(screen.queryByRole("radio", { name: /^Teen$/i })).toBeNull()
  })

  it("falls back to every tile when the restriction would leave none", () => {
    const full = render(<PersonPickerDetailed value={{}} onChange={() => {}} />)
    const all = ageTiles().length
    full.unmount()
    renderPerson({ age: ["no-such-id"] })
    expect(ageTiles()).toHaveLength(all)
  })

  it("leaves a dimension the card did not restrict untouched", () => {
    const full = render(<PersonPickerDetailed value={{}} onChange={() => {}} />)
    const frames = within(screen.getByRole("radiogroup", { name: /^Frame$/ })).getAllByRole("radio").length
    full.unmount()
    renderPerson({ age: ["age-20s"] })
    expect(within(screen.getByRole("radiogroup", { name: /^Frame$/ })).getAllByRole("radio")).toHaveLength(frames)
  })

  it("DimensionTileGrid filters by its `field` and ignores another field's restriction", () => {
    const entries = [
      { id: "a", label: "Alpha", description: "" },
      { id: "b", label: "Beta", description: "" },
    ]
    const grid = (field: string) => (
      <PickerFieldRestrictionsProvider allowedByField={{ f: ["a"] }}>
        <DimensionTileGrid entries={entries} value={undefined} onChange={() => {}} renderIcon={() => null} field={field} />
      </PickerFieldRestrictionsProvider>
    )
    const { unmount } = render(grid("f"))
    expect(screen.getAllByRole("radio")).toHaveLength(1)
    unmount()
    render(grid("other"))
    expect(screen.getAllByRole("radio")).toHaveLength(2)
  })
})
