import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ConfigPanel } from "../config"

const props = (data: Record<string, unknown>, onUpdate = vi.fn()) =>
  ({ data, onUpdate, kit: { localizeNodeLabel: (l: string) => l }, nodeId: "n1", sources: [], fieldMappings: {}, onMapField: vi.fn(), nodes: [] }) as unknown as Parameters<typeof ConfigPanel>[0]

describe("gif-to-video config panel", () => {
  it("shows the loop toggle and, while it is on, the target length", () => {
    const { rerender } = render(<ConfigPanel {...props({ loopToMinimum: true, targetDuration: 5 })} />)
    expect(screen.getByLabelText(/Extend short GIFs/)).toBeTruthy()
    expect(document.getElementById("gif-target-duration")).toBeTruthy()
    rerender(<ConfigPanel {...props({ loopToMinimum: false })} />)
    expect(document.getElementById("gif-target-duration")).toBeNull()
  })

  it("writes the loop toggle and the target length", () => {
    const onUpdate = vi.fn()
    render(<ConfigPanel {...props({ loopToMinimum: true, targetDuration: 3 }, onUpdate)} />)
    fireEvent.click(screen.getByLabelText(/Extend short GIFs/))
    expect(onUpdate).toHaveBeenCalledWith({ loopToMinimum: false })
    fireEvent.change(document.getElementById("gif-target-duration")!, { target: { value: "6" } })
    expect(onUpdate).toHaveBeenCalledWith({ targetDuration: 6 })
  })
})
