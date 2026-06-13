import { describe, it, expect, vi } from "vitest"
import { useState } from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { PersonConfig } from "../parameter-configs"
import type { PersonData } from "@/types/nodes"

// LocaleHeader → LocalePicker drags in router + react-query providers we don't
// mount here; it's decorative for this test, so stub it out.
vi.mock("../locale-header", () => ({ LocaleHeader: () => null }))

// Force the Detailed view so every dimension's option tiles render flat (Compact
// collapses them into popovers, which would hide the tile under test).
vi.mock("@/lib/parameter-node-prefs", async (orig) => ({
  ...(await orig<typeof import("@/lib/parameter-node-prefs")>()),
  getStickyPersonPickerMode: () => "detailed",
}))

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
  it("a picked eye-spacing option is reflected back as selected (the new field round-trips)", () => {
    render(<Harness />)
    // "Wide-set" is the eye-spacing → eye-wide-set option (label is unique to this dim).
    const tile = () => screen.getByRole("radio", { name: /^Wide-set$/i })
    expect(tile()).toHaveAttribute("aria-checked", "false")

    fireEvent.click(tile())

    // PersonConfig MUST forward data.eyeSpacing back into the picker's value.
    // If its value whitelist drops the new field, the tile never shows selected.
    expect(tile()).toHaveAttribute("aria-checked", "true")
  })
})
