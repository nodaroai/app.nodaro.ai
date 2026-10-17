import { describe, it, expect, vi, beforeEach } from "vitest"
import type { UnitExecKit } from "../../exec-kit"
import type { WorkflowNode } from "@/types/nodes"

const m = vi.hoisted(() => ({ toastError: vi.fn(), removeAudioApi: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: m.toastError } }))
vi.mock("../api", () => ({ removeAudioApi: m.removeAudioApi }))

import { executor } from "../exec"

const node = { id: "n1", type: "remove-audio", position: { x: 0, y: 0 }, data: { label: "Remove Audio", fieldMappings: {} } } as unknown as WorkflowNode

function kit(over: Partial<UnitExecKit> = {}): UnitExecKit {
  return {
    inputs: {},
    overrideMediaUrl: undefined,
    userId: "user-1",
    runProcessingNode: vi.fn(async (start: () => Promise<{ jobId: string }>) => { await start(); return "https://r2.test/silent.mp4" }),
    nodeRunError: vi.fn((key: string) => `Node "Remove Audio": ${key}`),
    setUserPromptTemplate: vi.fn(),
    nodeData: () => undefined,
    updateNodeData: vi.fn(),
    ...over,
  } as UnitExecKit
}

beforeEach(() => {
  m.toastError.mockReset()
  m.removeAudioApi.mockReset().mockResolvedValue({ jobId: "job-1" })
})

describe("remove-audio executor", () => {
  it("starts a job on the wired video and polls it into generatedVideoUrl", async () => {
    const k = kit({ inputs: { videoUrl: "https://media.test/wired.mp4" } })
    await expect(executor.execute(node, k)).resolves.toBe("https://r2.test/silent.mp4")
    expect(m.removeAudioApi).toHaveBeenCalledWith("https://media.test/wired.mp4", "user-1")
    expect(k.runProcessingNode).toHaveBeenCalledWith(expect.any(Function), "generatedVideoUrl", "Remove Audio")
    expect(k.setUserPromptTemplate).toHaveBeenCalledWith(undefined)
  })

  it("a list fan-out's media URL wins over the wired one", async () => {
    const k = kit({ inputs: { videoUrl: "https://media.test/wired.mp4" }, overrideMediaUrl: "https://media.test/item.mp4" })
    await executor.execute(node, k)
    expect(m.removeAudioApi).toHaveBeenCalledWith("https://media.test/item.mp4", "user-1")
  })

  it("no video: a toast in the node's name, and the run is refused before any request", async () => {
    const k = kit()
    await expect(executor.execute(node, k)).rejects.toThrow("No video")
    expect(k.nodeRunError).toHaveBeenCalledWith("nodeRun.noVideoInput")
    expect(m.toastError).toHaveBeenCalledWith('Node "Remove Audio": nodeRun.noVideoInput')
    expect(m.removeAudioApi).not.toHaveBeenCalled()
  })
})
