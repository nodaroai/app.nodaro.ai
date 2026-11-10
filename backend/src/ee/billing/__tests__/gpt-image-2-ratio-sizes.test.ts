// @test-units-by-name looks up only the four image node types it names (generate-image, image-to-image, modify-image, reference-board)
import { describe, expect, it } from "vitest"
import { getNodeModelIdentifier } from "../credits.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"
import type { SimpleNode } from "../../../services/workflow-engine/types.js"

/**
 * GPT Image 2 renders every ratio it offers at every size, "auto" and 1:1
 * included (no `resolutionsByAspectRatio` on its catalog entries). In a
 * workflow, a node asking for 2K or 4K at either is quoted (the estimate),
 * reserved (the run's credit id) and sent (the payload's size) at that size:
 * quote = charge = render.
 */

const SOURCE = "https://r2.nodaro.ai/in.png"

const CASES = [
  { type: "generate-image", provider: "gpt-image-2", inputs: {} },
  { type: "image-to-image", provider: "gpt-image-2-i2i", inputs: { imageUrl: SOURCE } },
  { type: "modify-image", provider: "gpt-image-2-i2i", inputs: { imageUrl: SOURCE } },
  { type: "reference-board", provider: "gpt-image-2", inputs: {} },
] as const

function node(type: string, data: Record<string, unknown>): SimpleNode {
  return { id: "n1", type, data: { prompt: "a lighthouse", boardTemplate: "character/full-board", ...data } }
}

describe("GPT Image 2 at auto and 1:1, in a workflow", () => {
  it.each(CASES.flatMap((c) => ["auto", "1:1"].map((ratio) => [c.type, c.provider, ratio, c.inputs] as const)))(
    "%s on %s at %s: a 2K / 4K node is quoted, charged and sent at that size",
    (type, provider, aspectRatio, inputs) => {
      for (const resolution of ["2K", "4K"]) {
        const n = node(type, { provider, aspectRatio, resolution })
        const built = buildPayload(n, "job-1", { ...inputs })
        expect(built.modelIdentifier).toBe(`${provider}:${resolution}`)
        expect(built.payload.resolution).toBe(resolution)
        expect(getNodeModelIdentifier(n as never, { imageRefsWired: 0 })).toBe(built.modelIdentifier)
      }
    },
  )
})

/**
 * A Modify Image node with no ratio asks for "auto" on every model
 * (`nodeAspectRatio`), GPT Image 2's edit included: its own auto keeps the
 * photo's shape. GPT Image 2 prices by size, so the node is quoted and charged
 * exactly as one that names "auto", at the size it asks for.
 */
describe("GPT Image 2's edit on a Modify Image node with no ratio", () => {
  it.each(["1K", "2K", "4K"])("at %s runs at 'auto', quoted and charged as 'auto' at that size", (resolution) => {
    const unset = node("modify-image", { provider: "gpt-image-2-i2i", resolution })
    const auto = node("modify-image", { provider: "gpt-image-2-i2i", resolution, aspectRatio: "auto" })
    const built = buildPayload(unset, "job-1", { imageUrl: SOURCE })
    const builtAuto = buildPayload(auto, "job-1", { imageUrl: SOURCE })
    expect(built.payload.aspectRatio).toBe("auto")
    expect(built.payload.resolution).toBe(resolution)
    expect(built.modelIdentifier).toBe(builtAuto.modelIdentifier)
    expect(built.modelIdentifier).toBe(resolution === "1K" ? "gpt-image-2-i2i" : `gpt-image-2-i2i:${resolution}`)
    expect(getNodeModelIdentifier(unset as never, { imageRefsWired: 0 })).toBe(built.modelIdentifier)
  })

  it("a named ratio is sent as named", () => {
    const built = buildPayload(node("modify-image", { provider: "gpt-image-2-i2i", resolution: "2K", aspectRatio: "3:4" }), "job-1", { imageUrl: SOURCE })
    expect(built.payload.aspectRatio).toBe("3:4")
    expect(built.modelIdentifier).toBe("gpt-image-2-i2i:2K")
  })
})
