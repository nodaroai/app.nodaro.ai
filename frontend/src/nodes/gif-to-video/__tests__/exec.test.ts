import { describe, it, expect, vi, beforeEach } from "vitest"
import type { UnitExecKit } from "../../exec-kit"
import type { WorkflowNode } from "@/types/nodes"

const m = vi.hoisted(() => ({ toastError: vi.fn(), gifToVideoApi: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: m.toastError } }))
vi.mock("../api", () => ({ gifToVideoApi: m.gifToVideoApi }))

import { executor } from "../exec"

const node = (data: Record<string, unknown> = {}) =>
  ({ id: "n1", type: "gif-to-video", position: { x: 0, y: 0 }, data: { label: "Gif to Video", fieldMappings: {}, ...data } }) as unknown as WorkflowNode

function kit(over: Partial<UnitExecKit> = {}): UnitExecKit {
  return {
    inputs: {},
    overrideMediaUrl: undefined,
    userId: "user-1",
    runProcessingNode: vi.fn(async (start: () => Promise<{ jobId: string }>) => { await start(); return "https://r2.test/out.mp4" }),
    nodeRunError: vi.fn((key: string) => `Node "Gif to Video": ${key}`),
    setUserPromptTemplate: vi.fn(),
    nodeData: () => undefined,
    updateNodeData: vi.fn(),
    ...over,
  } as UnitExecKit
}

const DEFAULTS = { loopToMinimum: true, targetDuration: 3, interpolate: true, alphaBackground: "white" }

beforeEach(() => {
  m.toastError.mockReset()
  m.gifToVideoApi.mockReset().mockResolvedValue({ jobId: "job-1" })
})

describe("gif-to-video executor", () => {
  it("starts a job on the wired GIF with the default settings and polls it into generatedVideoUrl", async () => {
    const k = kit({ inputs: { imageUrl: "https://media.test/wired.gif" } })
    await expect(executor.execute(node({ gifUrl: "https://media.test/own.gif" }), k)).resolves.toBe("https://r2.test/out.mp4")
    expect(m.gifToVideoApi).toHaveBeenCalledWith("https://media.test/wired.gif", DEFAULTS, "user-1")
    expect(k.runProcessingNode).toHaveBeenCalledWith(expect.any(Function), "generatedVideoUrl", "Gif to Video")
    expect(k.setUserPromptTemplate).not.toHaveBeenCalled()
  })

  it("a list fan-out's media URL wins over the wired GIF; with neither, the node's own upload", async () => {
    await executor.execute(node(), kit({ inputs: { imageUrl: "https://media.test/wired.gif" }, overrideMediaUrl: "https://media.test/item.gif" }))
    expect(m.gifToVideoApi).toHaveBeenLastCalledWith("https://media.test/item.gif", DEFAULTS, "user-1")
    await executor.execute(node({ gifUrl: "https://media.test/own.gif" }), kit())
    expect(m.gifToVideoApi).toHaveBeenLastCalledWith("https://media.test/own.gif", DEFAULTS, "user-1")
  })

  it("sends the node's settings", async () => {
    await executor.execute(node({ gifUrl: "https://media.test/own.gif", loopToMinimum: false, targetDuration: 7, interpolate: false, alphaBackground: "black" }), kit())
    expect(m.gifToVideoApi).toHaveBeenCalledWith("https://media.test/own.gif", { loopToMinimum: false, targetDuration: 7, interpolate: false, alphaBackground: "black" }, "user-1")
  })

  it("no GIF: a toast in the node's name, and the run is refused before any request", async () => {
    const k = kit()
    await expect(executor.execute(node(), k)).rejects.toThrow("No GIF")
    expect(k.nodeRunError).toHaveBeenCalledWith("nodeRun.noGIFWireAnImage")
    expect(m.toastError).toHaveBeenCalledWith('Node "Gif to Video": nodeRun.noGIFWireAnImage')
    expect(m.gifToVideoApi).not.toHaveBeenCalled()
  })
})
