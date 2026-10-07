// An app's Person card may restrict a dimension to a subset (R4). The card hands
// the per-field lists to the picker; a field with no list, or a list that would
// leave nothing, offers every option.
import { describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { PickerInputCard } from "../picker-input-card"

vi.mock("@/components/editor/locale-picker", () => ({ LocalePicker: () => null }))
vi.setConfig({ testTimeout: 15000 })

function renderPerson(allowedValuesByField?: Record<string, string[]>) {
  return render(
    <PickerInputCard
      nodeId="p1"
      label="Person"
      nodeType="person"
      data={{}}
      isFullscreen={false}
      inputValues={{}}
      onUpdateInput={() => {}}
      displayMode="inline"
      allowedValuesByField={allowedValuesByField}
    />,
  )
}

const tilesOf = (group: RegExp) => within(screen.getByRole("radiogroup", { name: group })).getAllByRole("radio")

describe("PickerInputCard — multi-dimension restrictions", () => {
  it("offers only the allowed ages", () => {
    renderPerson({ age: ["age-20s", "age-30s"] })
    expect(tilesOf(/^Age$/)).toHaveLength(2)
  })

  it("offers every age when the card has no restriction, or one that matches nothing", () => {
    const open = renderPerson()
    const all = tilesOf(/^Age$/).length
    expect(all).toBeGreaterThan(2)
    open.unmount()
    renderPerson({ age: ["no-such-id"] })
    expect(tilesOf(/^Age$/)).toHaveLength(all)
  })
})
