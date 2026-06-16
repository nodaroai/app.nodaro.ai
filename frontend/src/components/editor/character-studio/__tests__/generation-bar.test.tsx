import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// GenerationBar reads per-model credit cost; stub to 0 so cost labels don't
// interfere with the preset-state assertions.
vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 0 }))

import { GenerationBar } from "../generation-bar"

const BASE = {
  presets: ["smile", "angry", "neutral"] as const,
  models: ["nano-banana-pro"] as const,
  defaultModel: "nano-banana-pro",
  customPlaceholder: "Custom expression",
}

describe("GenerationBar preset states", () => {
  it("marks an already-generated preset as created + disabled", () => {
    render(
      <GenerationBar {...BASE} onGenerate={vi.fn()} createdNames={new Set(["smile"])} busyNames={new Set()} />,
    )
    const smile = screen.getByRole("button", { name: /smile/i })
    expect(smile).toBeDisabled()
    expect(smile).toHaveAttribute("data-state", "created")
  })

  it("marks an in-flight preset as creating + disabled", () => {
    render(
      <GenerationBar {...BASE} onGenerate={vi.fn()} createdNames={new Set()} busyNames={new Set(["angry"])} />,
    )
    const angry = screen.getByRole("button", { name: /angry/i })
    expect(angry).toBeDisabled()
    expect(angry).toHaveAttribute("data-state", "creating")
  })

  it("leaves an untouched preset idle + enabled", () => {
    render(
      <GenerationBar {...BASE} onGenerate={vi.fn()} createdNames={new Set(["smile"])} busyNames={new Set(["angry"])} />,
    )
    const neutral = screen.getByRole("button", { name: /neutral/i })
    expect(neutral).toBeEnabled()
    expect(neutral).toHaveAttribute("data-state", "idle")
  })

  it("fires onGenerate for an idle preset but not for a created one", async () => {
    const onGenerate = vi.fn()
    render(
      <GenerationBar {...BASE} onGenerate={onGenerate} createdNames={new Set(["smile"])} busyNames={new Set()} />,
    )
    await userEvent.click(screen.getByRole("button", { name: /neutral/i }))
    expect(onGenerate).toHaveBeenCalledWith("neutral", true, "nano-banana-pro")

    onGenerate.mockClear()
    await userEvent.click(screen.getByRole("button", { name: /smile/i }))
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it("treats omitted createdNames/busyNames as all-idle (back-compat)", () => {
    render(<GenerationBar {...BASE} onGenerate={vi.fn()} />)
    for (const p of BASE.presets) {
      const btn = screen.getByRole("button", { name: new RegExp(p, "i") })
      expect(btn).toBeEnabled()
      expect(btn).toHaveAttribute("data-state", "idle")
    }
  })
})
