import { describe, it, expect } from "vitest"
import { migrateDescribeToPickerNodes } from "../describe-to-picker-migration"

const node = (data: Record<string, unknown>) =>
  ({ id: "1", type: "describe-to-picker", position: { x: 0, y: 0 }, data }) as never

describe("migrateDescribeToPickerNodes", () => {
  it("wraps a flat (legacy person) generatedPickerJson into { person } and drops targetPicker", () => {
    const out = migrateDescribeToPickerNodes([
      node({ label: "x", generatedPickerJson: { age: "age-early-20s", type: "stylish-influencer" }, targetPicker: "person" }),
    ])
    expect((out[0].data as Record<string, unknown>).generatedPickerJson).toEqual({
      person: { age: "age-early-20s", type: "stylish-influencer" },
    })
    expect(out[0].data).not.toHaveProperty("targetPicker")
  })
  it("is idempotent for already-nested JSON", () => {
    const nested = { person: { age: "x" }, styling: { makeup: "m" } }
    const out = migrateDescribeToPickerNodes([node({ label: "x", generatedPickerJson: nested })])
    expect((out[0].data as Record<string, unknown>).generatedPickerJson).toEqual(nested)
  })
  it("leaves absent/empty generatedPickerJson alone", () => {
    const out = migrateDescribeToPickerNodes([node({ label: "x" })])
    expect((out[0].data as Record<string, unknown>).generatedPickerJson).toBeUndefined()
  })
  it("returns non-describe-to-picker nodes by reference", () => {
    const n = { id: "2", type: "person", position: { x: 0, y: 0 }, data: { label: "p" } } as never
    expect(migrateDescribeToPickerNodes([n])[0]).toBe(n)
  })
})
