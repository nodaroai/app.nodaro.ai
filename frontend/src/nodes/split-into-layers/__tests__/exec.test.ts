import { describe, it, expect, vi, beforeEach } from "vitest"
import type { UnitExecKit } from "../../exec-kit"
import type { WorkflowNode } from "@/types/nodes"

const m = vi.hoisted(() => ({ toastError: vi.fn(), splitIntoLayersApi: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: m.toastError } }))
vi.mock("../api", () => ({ splitIntoLayersApi: m.splitIntoLayersApi }))

import { executor } from "../exec"
import { definition } from "../definition.generated"

const node = (data: Record<string, unknown> = {}) =>
  ({ id: "n1", type: definition.type, position: { x: 0, y: 0 }, data: { ...definition.defaultData, ...data } }) as unknown as WorkflowNode

function kit(over: Partial<UnitExecKit> = {}): UnitExecKit {
  return {
    inputs: {},
    overrideMediaUrl: undefined,
    userId: "user-1",
    runProcessingNode: vi.fn(async (start: () => Promise<{ jobId: string }>) => { await start(); return "https://r2.test/base.png" }),
    runJsonNode: vi.fn(),
    nodeRunError: vi.fn((key: string) => `Node "Split into Layers": ${key}`),
    setUserPromptTemplate: vi.fn(),
    nodeData: () => undefined,
    updateNodeData: vi.fn(),
    ...over,
  } as UnitExecKit
}

beforeEach(() => {
  m.toastError.mockReset()
  m.splitIntoLayersApi.mockReset().mockResolvedValue({ jobId: "job-1" })
})

describe("split-into-layers executor", () => {
  it("starts a job on the wired image with the default settings and polls its base into generatedImageUrl", async () => {
    const k = kit({ inputs: { imageUrl: "https://media.test/wired.png" } })
    await expect(executor.execute(node({ imageUrl: "https://media.test/own.png" }), k)).resolves.toBe("https://r2.test/base.png")
    expect(m.splitIntoLayersApi).toHaveBeenCalledWith({ imageUrl: "https://media.test/wired.png", maxLayers: 9, size: "1K" }, "user-1")
    expect(k.runProcessingNode).toHaveBeenCalledWith(expect.any(Function), "generatedImageUrl", definition.label)
  })

  it("a list fan-out's item wins over the wired image; with neither, the image uploaded on the node", async () => {
    await executor.execute(node(), kit({ inputs: { imageUrl: "https://media.test/wired.png" }, overrideMediaUrl: "https://media.test/item.png" }))
    expect(m.splitIntoLayersApi).toHaveBeenLastCalledWith(expect.objectContaining({ imageUrl: "https://media.test/item.png" }), "user-1")
    await executor.execute(node({ imageUrl: "https://media.test/own.png" }), kit())
    expect(m.splitIntoLayersApi).toHaveBeenLastCalledWith(expect.objectContaining({ imageUrl: "https://media.test/own.png" }), "user-1")
  })

  it("sends the node's settings through the run rules: Max layers held to 1–99, an unknown size the default, the description trimmed", async () => {
    await executor.execute(node({ imageUrl: "https://media.test/own.png", maxLayers: 24, size: "1.5K", prompt: "  the logo <bbox>10 20 300 400</bbox>  " }), kit())
    expect(m.splitIntoLayersApi).toHaveBeenLastCalledWith({ imageUrl: "https://media.test/own.png", maxLayers: 24, size: "1.5K", prompt: "the logo <bbox>10 20 300 400</bbox>" }, "user-1")
    await executor.execute(node({ imageUrl: "https://media.test/own.png", maxLayers: 500, size: "4K", prompt: "   " }), kit())
    expect(m.splitIntoLayersApi).toHaveBeenLastCalledWith({ imageUrl: "https://media.test/own.png", maxLayers: 99, size: "1K" }, "user-1")
    await executor.execute(node({ imageUrl: "https://media.test/own.png", maxLayers: 0, size: "auto", prompt: "x".repeat(2500) }), kit())
    expect(m.splitIntoLayersApi).toHaveBeenLastCalledWith({ imageUrl: "https://media.test/own.png", maxLayers: 1, size: "auto", prompt: "x".repeat(2000) }, "user-1")
  })

  it("no image: a toast in the node's name, and the run is refused before any request", async () => {
    const k = kit()
    await expect(executor.execute(node(), k)).rejects.toThrow("No image")
    expect(k.nodeRunError).toHaveBeenCalledWith("nodeRun.noSourceImageFoundWire")
    expect(m.toastError).toHaveBeenCalledWith('Node "Split into Layers": nodeRun.noSourceImageFoundWire')
    expect(m.splitIntoLayersApi).not.toHaveBeenCalled()
    expect(k.runProcessingNode).not.toHaveBeenCalled()
  })
})
