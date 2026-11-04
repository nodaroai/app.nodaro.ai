// Shot Cuts' panel: the frames toggle (off by default), and the last run's shots.
import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ConfigPanel } from "../config"

const kit = { localizeNodeLabel: (label: string) => label }

function renderPanel(data: Record<string, unknown>) {
  const onUpdate = vi.fn()
  render(<ConfigPanel data={{ label: "Shot Cuts", fieldMappings: {}, ...data } as never} onUpdate={onUpdate} sources={[]} fieldMappings={{}} onMapField={vi.fn()} nodes={[]} kit={kit} nodeId="sc" />)
  return onUpdate
}

describe("shot-cuts config panel", () => {
  it("frames are off by default; turning them on writes frames: true", () => {
    const onUpdate = renderPanel({})
    const toggle = screen.getByRole("switch")
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    fireEvent.click(toggle)
    expect(onUpdate).toHaveBeenCalledWith({ frames: true })
  })

  it("lists the last run's shots with their times", () => {
    renderPanel({
      generatedJson: { shotCount: 2, cutsSec: [1.5], durationSec: 62.25, shots: [
        { index: 0, startSec: 0, endSec: 1.5, durationSec: 1.5 },
        { index: 1, startSec: 1.5, endSec: 62.25, durationSec: 60.75 },
      ] },
    })
    expect(screen.getByText("Shots: 2")).toBeTruthy()
    expect(screen.getByText("Shot 1: 0:00.000 – 0:01.500")).toBeTruthy()
    expect(screen.getByText("Shot 2: 0:01.500 – 1:02.250")).toBeTruthy()
  })
})
