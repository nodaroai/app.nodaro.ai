import { describe, it, expect, vi, beforeEach } from "vitest"
import type { UnitExecKit } from "../../exec-kit"
import type { WorkflowNode } from "@/types/nodes"

const m = vi.hoisted(() => ({ toastError: vi.fn(), longImageApi: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: m.toastError } }))
vi.mock("../api", () => ({ longImageApi: m.longImageApi }))

import { executor } from "../exec"
import { definition } from "../definition.generated"

const A = "https://media.test/a.png"
const B = "https://media.test/b.png"

const node = (data: Record<string, unknown> = {}) =>
  ({ id: "n1", type: definition.type, position: { x: 0, y: 0 }, data: { ...definition.defaultData, ...data } }) as unknown as WorkflowNode

function kit(over: Partial<UnitExecKit> = {}): UnitExecKit {
  return {
    inputs: {},
    overrideMediaUrl: undefined,
    userId: "user-1",
    runProcessingNode: vi.fn(async (start: () => Promise<{ jobId: string }>) => { await start(); return "https://r2.test/page.png" }),
    runJsonNode: vi.fn(),
    nodeRunError: vi.fn((key: string) => key),
    setUserPromptTemplate: vi.fn(),
    nodeData: () => undefined,
    updateNodeData: vi.fn(),
    ...over,
  } as UnitExecKit
}

beforeEach(() => {
  m.toastError.mockReset()
  m.longImageApi.mockReset().mockResolvedValue({ jobId: "job-1" })
})

describe("long-image executor", () => {
  it("a webpage design from the node's prompt at the defaults, polled into generatedImageUrl", async () => {
    const k = kit()
    await expect(executor.execute(node({ prompt: " a bakery page " }), k)).resolves.toBe("https://r2.test/page.png")
    expect(m.longImageApi).toHaveBeenCalledWith({ mode: "webpage", resolution: "2K", prompt: "a bakery page" }, "user-1")
    expect(k.runProcessingNode).toHaveBeenCalledWith(expect.any(Function), "generatedImageUrl", definition.label)
  })

  it("wired text wins, and each picture comes from its own input: only the mode's", async () => {
    const inputs = { prompt: "wired", unitInputs: { styleImage: A, productImage1: B } }
    await executor.execute(node({ prompt: "own", resolution: "1K" }), kit({ inputs }))
    expect(m.longImageApi).toHaveBeenLastCalledWith({ mode: "webpage", resolution: "1K", prompt: "wired", styleImageUrl: A }, "user-1")
    await executor.execute(node({ mode: "ecommerce", length: "long", prompt: "own" }), kit({ inputs: { unitInputs: { productImage2: A, styleImage: B } } }))
    expect(m.longImageApi).toHaveBeenLastCalledWith({ mode: "ecommerce", resolution: "2K", length: "long", prompt: "own", productImageUrls: [null, A] }, "user-1")
  })

  it("a list's item is read on the input it drives, never from the media override that names no input", async () => {
    await executor.execute(node({ prompt: "p" }), kit({ overrideMediaUrl: B, inputs: { unitInputs: { subjectImage: A } } }))
    expect(m.longImageApi).toHaveBeenLastCalledWith({ mode: "webpage", resolution: "2K", prompt: "p", subjectImageUrl: A }, "user-1")
  })

  it("refuses before any request, with the server's sentence: no prompt, no product picture, a wired input that made no picture", async () => {
    for (const [data, inputs, message] of [
      [{ prompt: "" }, {}, "Long Image needs a prompt."],
      [{ mode: "ecommerce", prompt: "p" }, {}, "A product page needs one to three product pictures."],
      [{ mode: "ecommerce", prompt: "p" }, { unitInputs: { productImage1: A, productImage3: "" } }, "Product image 3 is wired, but its input made no picture."],
    ] as const) {
      await expect(executor.execute(node(data), kit({ inputs }))).rejects.toThrow(message)
      expect(m.toastError).toHaveBeenLastCalledWith(message)
    }
    expect(m.longImageApi).not.toHaveBeenCalled()
  })
})
