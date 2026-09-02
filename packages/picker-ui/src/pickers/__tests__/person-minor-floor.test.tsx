import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import {
  getRegisteredPeople,
  getAdultOnlyIds,
  getRegisteredPersonDimensionLabels,
  getPersonDimensionLimit,
  type Person,
} from "@nodaro/prompts"
import { PersonPickerDetailed } from "../person-picker-detailed"

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Locates the rendered chip container for a person dimension. Ungrouped
 * dimensions render one flat `radiogroup`/`group` whose `aria-label` is the
 * dimension's label exactly. The two grouped/tabbed dimensions (`type`,
 * `ethnicity`) render only the ACTIVE tab's chips, inside a container whose
 * `aria-label` is the dimension label suffixed with `— <active group>` — a
 * prefix match finds it regardless of which tab is active.
 *
 * Scoping matters here: several flagged labels are reused by unrelated,
 * non-flagged entries in OTHER dimensions (e.g. "Small" is both the flagged
 * `bust-small` and the non-flagged `lips-small`), so an unscoped
 * `screen.queryByText(label)` would report the flagged tile as "present"
 * whenever its label happens to collide with a sibling in a dimension that
 * legitimately still renders.
 */
function dimensionContainer(dimension: string): HTMLElement | null {
  const baseLabel = getRegisteredPersonDimensionLabels()[dimension as never]
  const maxSelected = getPersonDimensionLimit(dimension as never)
  const label = maxSelected > 1 ? `${baseLabel} (pick up to ${maxSelected})` : baseLabel
  const role = maxSelected > 1 ? "group" : "radiogroup"
  return (
    screen.queryByRole(role, { name: label }) ??
    screen.queryByRole(role, { name: new RegExp(`^${escapeRegExp(label)}`) })
  )
}

describe("PersonPickerDetailed — minor-age floor", () => {
  it("hides adultOnly tiles when the age is a minor and shows them for an adult", () => {
    const { rerender } = render(<PersonPickerDetailed value={{ age: "age-child" }} onChange={() => {}} />)
    expect(screen.queryByText("Very Full")).toBeNull()
    rerender(<PersonPickerDetailed value={{ age: "age-30s" }} onChange={() => {}} />)
    expect(screen.getByText("Very Full")).toBeTruthy()
  })

  it("clears a stale flagged pick when the age flips to a minor", () => {
    const onChange = vi.fn()
    const { rerender } = render(<PersonPickerDetailed value={{ age: "age-30s", bust: "bust-very-full" }} onChange={onChange} />)
    rerender(<PersonPickerDetailed value={{ age: "age-child", bust: "bust-very-full" }} onChange={onChange} />)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ bust: undefined }))
  })

  it("never calls onChange for an adult, even with a flagged value pre-selected", () => {
    const onChange = vi.fn()
    render(<PersonPickerDetailed value={{ age: "age-30s", bust: "bust-very-full" }} onChange={onChange} />)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("clears a scalar AND an array flagged field in exactly ONE onChange when the age flips to a minor", () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <PersonPickerDetailed
        value={{ age: "age-30s", bust: "bust-very-full", lipState: ["lip-state-parted"] }}
        onChange={onChange}
      />,
    )
    expect(onChange).not.toHaveBeenCalled()
    rerender(
      <PersonPickerDetailed
        value={{ age: "age-child", bust: "bust-very-full", lipState: ["lip-state-parted"] }}
        onChange={onChange}
      />,
    )
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ bust: undefined, lipState: undefined }))
  })

  it("switching back to adult re-shows the tile without any onChange resurrecting the cleared value", () => {
    const onChange = vi.fn()
    // Simulate the real controlled round-trip: onChange merges its patch into
    // the value a consumer would hold, so the NEXT render reflects what the
    // clearing effect actually wrote (rather than re-asserting a hand-picked
    // "already cleared" value).
    let value: { age?: string; bust?: string } = { age: "age-30s", bust: "bust-very-full" }
    const handleChange = (patch: Partial<typeof value>) => {
      onChange(patch)
      value = { ...value, ...patch }
    }
    const { rerender } = render(<PersonPickerDetailed value={value} onChange={handleChange} />)
    rerender(<PersonPickerDetailed value={{ age: "age-child", bust: "bust-very-full" }} onChange={handleChange} />)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(value.bust).toBeUndefined()

    onChange.mockClear()
    rerender(<PersonPickerDetailed value={{ ...value, age: "age-30s" }} onChange={handleChange} />)
    expect(screen.getByText("Very Full")).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    expect(value.bust).toBeUndefined()
  })

  it("hides every adultOnly person tile in every dimension at a minor age", () => {
    render(<PersonPickerDetailed value={{ age: "age-child" }} onChange={() => {}} />)
    const flaggedIds = getAdultOnlyIds()
    const flaggedPeople = (getRegisteredPeople() as readonly Person[]).filter((p) => flaggedIds.has(p.id))
    // Sanity: the flagged set spans several dimensions, not just bust — this
    // guards against the check degenerating into a single-dimension test.
    expect(flaggedPeople.length).toBeGreaterThan(10)
    expect(new Set(flaggedPeople.map((p) => p.dimension)).size).toBeGreaterThan(3)
    for (const p of flaggedPeople) {
      const container = dimensionContainer(p.dimension)
      expect(container).toBeTruthy()
      if (container) expect(within(container).queryByText(p.label)).toBeNull()
    }
  })
})
