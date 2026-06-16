import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PresetChips } from "../preset-chips"

const BASE = {
  presets: ["front", "side", "top"],
  createdNames: new Set<string>(),
  busyNames: new Set<string>(),
}

describe("PresetChips", () => {
  it("renders one chip per preset", () => {
    render(<PresetChips {...BASE} onPick={vi.fn()} />)
    for (const p of BASE.presets) {
      expect(screen.getByRole("button", { name: new RegExp(p, "i") })).toBeInTheDocument()
    }
  })

  it("marks an already-generated preset as created + disabled", () => {
    render(<PresetChips {...BASE} createdNames={new Set(["front"])} onPick={vi.fn()} />)
    const front = screen.getByRole("button", { name: /front/i })
    expect(front).toBeDisabled()
    expect(front).toHaveAttribute("data-state", "created")
  })

  it("marks an in-flight preset as creating + disabled", () => {
    render(<PresetChips {...BASE} busyNames={new Set(["side"])} onPick={vi.fn()} />)
    const side = screen.getByRole("button", { name: /side/i })
    expect(side).toBeDisabled()
    expect(side).toHaveAttribute("data-state", "creating")
  })

  it("fires onPick for an idle chip but not a created one", async () => {
    const onPick = vi.fn()
    render(<PresetChips {...BASE} createdNames={new Set(["front"])} onPick={onPick} />)
    await userEvent.click(screen.getByRole("button", { name: /top/i }))
    expect(onPick).toHaveBeenCalledWith("top")
    onPick.mockClear()
    await userEvent.click(screen.getByRole("button", { name: /front/i }))
    expect(onPick).not.toHaveBeenCalled()
  })

  it("disables every chip when the whole bar is disabled", () => {
    render(<PresetChips {...BASE} disabled onPick={vi.fn()} />)
    for (const p of BASE.presets) {
      expect(screen.getByRole("button", { name: new RegExp(p, "i") })).toBeDisabled()
    }
  })

  it("shows the disabledHint as the chip tooltip when the bar is disabled", () => {
    render(<PresetChips {...BASE} disabled disabledHint="Approve a main image first" onPick={vi.fn()} />)
    expect(screen.getByRole("button", { name: /front/i })).toHaveAttribute("title", "Approve a main image first")
  })
})
