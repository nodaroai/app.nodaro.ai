// A single-dimension picker card can be restricted to a subset of its catalog,
// and the runner enforces that on every submitted value. Clear (X) therefore
// must withdraw the viewer's pick — never submit the catalog default, which the
// restriction may exclude (it would turn a harmless Clear into a 400).
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { PickerInputCard, type PickerDisplayMode } from "../picker-input-card"

vi.mock("@/components/editor/locale-picker", () => ({ LocalePicker: () => null }))
vi.setConfig({ testTimeout: 15000 })

function renderEra(mode: PickerDisplayMode, inputValues: Record<string, Record<string, unknown>>, onUpdateInput = vi.fn()) {
  render(
    <PickerInputCard
      nodeId="n1"
      label="Era"
      nodeType="era"
      data={{ era: "1920s-flapper" }}
      isFullscreen
      inputValues={inputValues}
      onUpdateInput={onUpdateInput}
      displayMode={mode}
      allowedValues={["1920s-flapper", "1950s-diner"]}
    />,
  )
  return onUpdateInput
}

describe("PickerInputCard — Clear on a restricted single picker", () => {
  it.each<PickerDisplayMode>(["modal", "compact"])("%s: Clear drops the viewer's pick instead of submitting the default", (mode) => {
    const onUpdateInput = renderEra(mode, { n1: { era: "1950s-diner" } })
    fireEvent.click(screen.getByRole("button", { name: /clear/i }))
    expect(onUpdateInput).toHaveBeenCalledTimes(1)
    expect(onUpdateInput).toHaveBeenCalledWith("n1", "era", undefined)
  })

  it("offers no Clear while the viewer has not picked anything", () => {
    renderEra("modal", {})
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull()
  })
})
