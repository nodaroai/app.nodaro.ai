import { describe, it, expect, vi, beforeAll } from "vitest"
import { useState } from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { PersonConfig } from "../parameter-configs"
import { PICKER_UI_MODE } from "@/lib/picker-ui"
import type { PersonData } from "@/types/nodes"

// The roundtrip drives the RICH person picker's tile UI; the community stub
// renders per-field selects instead (its picking is covered by the package's
// own person-picker tests). Skip on the stub lane.
const itRich = (PICKER_UI_MODE as string) === "rich" ? it : it.skip

// LocaleHeader → LocalePicker drags in router + react-query providers we don't
// mount here; it's decorative for this test, so stub it out.
vi.mock("../locale-header", () => ({ LocaleHeader: () => null }))

// Force the Detailed view so every dimension's option tiles render flat (Compact
// collapses them into popovers, which would hide the tile under test).
// Via the REAL sticky-mode storage key (not a module mock): in the rich lane
// the PersonPicker reads the package's own prefs module, which a mock of the
// app path cannot intercept — localStorage is the shared contract.
beforeAll(() => {
  window.localStorage.setItem("nodaro:person-picker-view", "detailed")
})

// Rendering the full PersonConfig (all dimensions + options) is heavy.
vi.setConfig({ testTimeout: 15000 })

/** A controlled harness: PersonConfig is value-driven, so we feed onUpdate
 *  patches straight back into `data` — exactly what the real config panel does. */
function Harness() {
  const [data, setData] = useState<PersonData>({} as PersonData)
  return (
    <PersonConfig
      data={data}
      onUpdate={(patch) => setData((d) => ({ ...d, ...patch }))}
      sources={[]}
      fieldMappings={{}}
      onMapField={() => {}}
      nodes={[]}
    />
  )
}

describe("PersonConfig round-trip — facial-geometry fields", () => {
  itRich("a picked eye-spacing option is reflected back as selected (the new field round-trips)", () => {
    render(<Harness />)
    // "Wide-set" is the eye-spacing → eye-wide-set option (label is unique to this dim).
    // Locate the unique visible label once. Recomputing accessible names for
    // every radio in this full catalog three times can exceed the CI budget.
    const tile = screen.getByText(/^Wide-set$/i).closest('[role="radio"]')!
    expect(tile).toHaveAttribute("role", "radio")
    expect(tile).toHaveAttribute("aria-checked", "false")

    fireEvent.click(tile)

    // PersonConfig MUST forward data.eyeSpacing back into the picker's value.
    // If its value whitelist drops the new field, the tile never shows selected.
    expect(tile).toHaveAttribute("aria-checked", "true")
  })
})
