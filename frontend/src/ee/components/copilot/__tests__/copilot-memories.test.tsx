/**
 * The consent surface of copilot memory: every save is a visible pinned line,
 * and the undo deletes FIRST — a pin that vanishes while the row survives
 * would be false comfort, the exact thing this surface exists to prevent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemorySavedPins } from "../copilot-memories"
import { useCopilotStore } from "@/ee/lib/copilot/turn-store"
import { EMPTY_TURN } from "@/ee/lib/copilot/types"

const api = vi.hoisted(() => ({
  deleteCopilotMemory: vi.fn(async () => ({ deleted: true })),
  listCopilotMemories: vi.fn(async () => ({ memories: [] as unknown[] })),
}))
vi.mock("@/ee/lib/copilot/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ee/lib/copilot/api")>()
  return { ...actual, deleteCopilotMemory: api.deleteCopilotMemory, listCopilotMemories: api.listCopilotMemories }
})

beforeEach(() => {
  vi.clearAllMocks()
  useCopilotStore.setState({
    turn: { ...EMPTY_TURN, memorySaves: [{ id: "m1", content: "always 9:16" }] },
    notice: null,
  })
})

describe("MemorySavedPins", () => {
  it("renders one pinned line per save, with its content visible", () => {
    render(<MemorySavedPins />)
    expect(screen.getByText(/always 9:16/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy()
  })

  it("undo deletes on the server FIRST and only then drops the pin", async () => {
    render(<MemorySavedPins />)
    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    await waitFor(() => {
      expect(api.deleteCopilotMemory).toHaveBeenCalledWith("m1")
      expect(useCopilotStore.getState().turn.memorySaves).toHaveLength(0)
    })
  })

  it("a failed undo keeps the pin and tells the user where to delete instead", async () => {
    api.deleteCopilotMemory.mockRejectedValueOnce(new Error("network"))
    render(<MemorySavedPins />)
    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    await waitFor(() => {
      expect(useCopilotStore.getState().turn.memorySaves).toHaveLength(1)
      expect(useCopilotStore.getState().notice).toContain("remembers")
    })
  })

  it("renders nothing when the turn saved nothing", () => {
    useCopilotStore.setState({ turn: { ...EMPTY_TURN, memorySaves: [] } })
    const { container } = render(<MemorySavedPins />)
    expect(container.innerHTML).toBe("")
  })
})
