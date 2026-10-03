// A new look-picker node starts with the real / illustration choice the user
// last made on THAT type; a type never switched gets no `previewStyle` at all
// (= real), and nodes already on the canvas are never touched.
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@xyflow/react", async () => vi.importActual<typeof import("@xyflow/react")>("@xyflow/react"))

const sticky: Record<string, "real" | "illustration"> = {}
vi.mock("@/lib/parameter-node-prefs", () => ({
  getStickyParameterDisplayMode: vi.fn(() => "picks"),
  setStickyParameterDisplayMode: vi.fn(),
  getStickyLookPreviewStyle: vi.fn((type: string) => sticky[type]),
  setStickyLookPreviewStyle: vi.fn(),
}))

vi.mock("@/components/editor/workflow-editor/auto-execute", () => ({
  autoExecuteNode: vi.fn(),
  cascadeAutoExecute: vi.fn(),
}))

import { useWorkflowStore } from "../use-workflow-store"

const initialState = useWorkflowStore.getState()

beforeEach(() => {
  useWorkflowStore.setState(initialState, true)
  for (const k of Object.keys(sticky)) delete sticky[k]
})

const dataOf = (id: string | undefined) => useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data as Record<string, unknown>

describe("addNode seeds the look preview style per type", () => {
  it("seeds a new node from the last choice on its type", () => {
    sticky["camera-motion"] = "illustration"
    const id = useWorkflowStore.getState().addNode("camera-motion", { x: 0, y: 0 })
    expect(dataOf(id).previewStyle).toBe("illustration")
  })

  it("leaves previewStyle absent for a type the user never switched", () => {
    sticky["camera-motion"] = "illustration"
    const id = useWorkflowStore.getState().addNode("color-look", { x: 0, y: 0 })
    expect(dataOf(id)).not.toHaveProperty("previewStyle")
  })

  it("does not change nodes already on the canvas", () => {
    const first = useWorkflowStore.getState().addNode("style", { x: 0, y: 0 })
    sticky.style = "illustration"
    const second = useWorkflowStore.getState().addNode("style", { x: 300, y: 0 })
    expect(dataOf(first)).not.toHaveProperty("previewStyle")
    expect(dataOf(second).previewStyle).toBe("illustration")
  })

  it("keeps an explicit previewStyle passed by the caller", () => {
    sticky.style = "illustration"
    const id = useWorkflowStore.getState().addNode("style", { x: 0, y: 0 }, { previewStyle: "real" })
    expect(dataOf(id).previewStyle).toBe("real")
  })
})
