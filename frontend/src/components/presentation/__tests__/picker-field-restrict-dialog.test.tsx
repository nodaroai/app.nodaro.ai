// The editor's per-field restriction dialog for a multi-dimension picker (R4):
// it lists a restrictable field's values and writes the WHOLE next
// pickerAllowedValuesByField map, dropping a field once nothing is restricted.
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { getParameterPickerMeta, type MultiDimParameterPickerMeta } from "@/lib/picker-ui"
import { PickerFieldRestrictDialog, restrictableDimensions } from "../picker-restrict-dialog"

vi.setConfig({ testTimeout: 15000 })

const meta = getParameterPickerMeta("person") as MultiDimParameterPickerMeta
const first = restrictableDimensions(meta)[0]!
const firstTwo = first.options.slice(0, 2).map((o) => o.id)

function open(value: Record<string, string[]> | undefined, onChange = vi.fn()) {
  render(<PickerFieldRestrictDialog open onOpenChange={() => {}} meta={meta} value={value} onChange={onChange} />)
  return onChange
}

describe("PickerFieldRestrictDialog", () => {
  it("only Person offers per-field restriction today (its tiles honour it)", () => {
    expect(meta.honoursFieldRestrictions).toBe(true)
    expect(restrictableDimensions(meta).length).toBeGreaterThan(3)
  })

  it("unchecking a value restricts that field to the rest, leaving other fields as they were", () => {
    const onChange = open({ other: ["x"] })
    fireEvent.click(screen.getAllByRole("checkbox")[0]!)
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0]![0] as Record<string, string[]>
    expect(next.other).toEqual(["x"])
    expect(next[first.field]).toHaveLength(first.options.length - 1)
    expect(next[first.field]).not.toContain(first.options[0]!.id)
  })

  it("checking the last missing value drops the field's key, and the map when it was the only one", () => {
    const all = first.options.map((o) => o.id)
    const onChange = open({ [first.field]: all.slice(1) })
    fireEvent.click(screen.getAllByRole("checkbox")[0]!)
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it("shows how many values are allowed", () => {
    open({ [first.field]: firstTwo })
    expect(screen.getByText(`2/${first.options.length} values allowed`)).toBeInTheDocument()
  })
})
