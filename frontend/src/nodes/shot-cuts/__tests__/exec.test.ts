import { describe, it, expect, vi, beforeEach } from "vitest"
import type { UnitExecKit } from "../../exec-kit"
import type { WorkflowNode } from "@/types/nodes"

const m = vi.hoisted(() => ({ toastError: vi.fn(), shotCutsApi: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: m.toastError } }))
vi.mock("../api", () => ({ shotCutsApi: m.shotCutsApi }))

import { executor } from "../exec"

const nodeWith = (data: Record<string, unknown> = {}) =>
  ({ id: "n1", type: "shot-cuts", position: { x: 0, y: 0 }, data: { label: "Shot Cuts", fieldMappings: {}, ...data } }) as unknown as WorkflowNode

function kit(over: Partial<UnitExecKit> = {}): UnitExecKit {
  return {
    inputs: {},
    overrideMediaUrl: undefined,
    userId: "user-1",
    runProcessingNode: vi.fn(),
    runJsonNode: vi.fn(async (start: () => Promise<{ jobId: string }>) => { await start(); return "{\"shotCount\":1}" }),
    nodeRunError: vi.fn((key: string) => `Node "Shot Cuts": ${key}`),
    setUserPromptTemplate: vi.fn(),
    nodeData: () => undefined,
    updateNodeData: vi.fn(),
    ...over,
  } as UnitExecKit
}

beforeEach(() => {
  m.toastError.mockReset()
  m.shotCutsApi.mockReset().mockResolvedValue({ jobId: "job-1" })
})

describe("shot-cuts executor", () => {
  it("starts a job on the wired video, frames off by default, and lands its JSON outputs", async () => {
    const k = kit({ inputs: { videoUrl: "https://media.test/wired.mp4" } })
    await expect(executor.execute(nodeWith(), k)).resolves.toBe("{\"shotCount\":1}")
    expect(m.shotCutsApi).toHaveBeenCalledWith({ videoUrl: "https://media.test/wired.mp4", frames: false }, "user-1")
    expect(k.runJsonNode).toHaveBeenCalledWith(expect.any(Function), "Shot Cuts")
    expect(k.runProcessingNode).not.toHaveBeenCalled()
    expect(k.setUserPromptTemplate).toHaveBeenCalledWith(undefined)
  })

  it("sends the node's frames toggle; a list fan-out's media URL wins over the wired one", async () => {
    const k = kit({ inputs: { videoUrl: "https://media.test/wired.mp4" }, overrideMediaUrl: "https://media.test/item.mp4" })
    await executor.execute(nodeWith({ frames: true }), k)
    expect(m.shotCutsApi).toHaveBeenCalledWith({ videoUrl: "https://media.test/item.mp4", frames: true }, "user-1")
  })

  it("no video: a toast in the node's name, and the run is refused before any request", async () => {
    const k = kit()
    await expect(executor.execute(nodeWith(), k)).rejects.toThrow("No video")
    expect(m.toastError).toHaveBeenCalledWith('Node "Shot Cuts": nodeRun.noVideoInput')
    expect(m.shotCutsApi).not.toHaveBeenCalled()
  })
})
