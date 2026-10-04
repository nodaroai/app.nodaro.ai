/**
 * The model ladder in the header's settings: three rungs, local-first
 * switching, and the composer's price badge following the thread's rung.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { CopilotHeader } from "../copilot-header"
import { useCopilotStore } from "@/ee/lib/copilot/turn-store"
import { copilotFeatureId } from "@/ee/lib/copilot/constants"

const onChangeSettings = vi.fn()

/** The settings sit behind the header's settings button ("Ask · Smart"). */
function renderHeaderWithSettings() {
  render(<CopilotHeader onClose={() => undefined} onMinimize={() => undefined} onChangeSettings={onChangeSettings} />)
  fireEvent.click(screen.getByRole("button", { name: "Copilot settings" }))
}

beforeEach(() => {
  onChangeSettings.mockReset()
  useCopilotStore.setState({ runMode: "ask", autoRunLimit: 100, modelTier: "standard" })
})

describe("the model ladder control", () => {
  it("keeps the rungs out of sight until the settings open", () => {
    render(<CopilotHeader onClose={() => undefined} onMinimize={() => undefined} onChangeSettings={onChangeSettings} />)
    expect(screen.queryByRole("radiogroup", { name: "Model" })).toBeNull()
    // The button names the current choice instead.
    expect(screen.getByRole("button", { name: "Copilot settings" }).textContent).toContain("Smart")
  })

  it("renders three rungs with the current one checked", () => {
    renderHeaderWithSettings()
    const group = screen.getByRole("radiogroup", { name: "Model" })
    expect(group).toBeTruthy()
    expect(screen.getByRole("radio", { name: "Smart" }).getAttribute("aria-checked")).toBe("true")
    expect(screen.getByRole("radio", { name: "Fast" }).getAttribute("aria-checked")).toBe("false")
    expect(screen.getByRole("radio", { name: "Max" }).getAttribute("aria-checked")).toBe("false")
  })

  it("clicking a rung patches modelTier — and clicking the active one does not", () => {
    renderHeaderWithSettings()
    fireEvent.click(screen.getByRole("radio", { name: "Max" }))
    expect(onChangeSettings).toHaveBeenCalledWith({ modelTier: "premium" })
    onChangeSettings.mockReset()
    fireEvent.click(screen.getByRole("radio", { name: "Smart" }))
    expect(onChangeSettings).not.toHaveBeenCalled()
  })
})

describe("the price badge id", () => {
  it("follows the rung: bare id for standard, composites for the others", () => {
    expect(copilotFeatureId("standard")).toBe("workflow-copilot")
    expect(copilotFeatureId("economy")).toBe("workflow-copilot:economy")
    expect(copilotFeatureId("premium")).toBe("workflow-copilot:premium")
    expect(copilotFeatureId(undefined)).toBe("workflow-copilot")
  })
})
