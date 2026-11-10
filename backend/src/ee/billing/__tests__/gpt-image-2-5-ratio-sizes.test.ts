// @test-units-by-name looks up only the four image node types it names (generate-image, image-to-image, modify-image, reference-board)
import { describe, expect, it } from "vitest"
import { getNodeModelIdentifier } from "../credits.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"
import type { SimpleNode } from "../../../services/workflow-engine/types.js"

/**
 * GPT Image 2.5 renders 27:16, 16:27, 9:8 and 8:9 at 1K only (the catalog's
 * `resolutionsByAspectRatio`). In a workflow, a node asking for 2K or 4K at one
 * of those ratios is quoted (the estimate), reserved (the run's credit id) and
 * sent (the payload's size) at 1K: quote = charge = render.
 */

const SOURCE = "https://r2.nodaro.ai/in.png"
const ONE_K_ONLY = ["27:16", "16:27", "9:8", "8:9"] as const

const CASES = [
  { type: "generate-image", provider: "gpt-image-2-5-flare", inputs: {} },
  { type: "generate-image", provider: "gpt-image-2-5-sunburst", inputs: {} },
  { type: "image-to-image", provider: "gpt-image-2-5-flare-i2i", inputs: { imageUrl: SOURCE } },
  { type: "modify-image", provider: "gpt-image-2-5-sunburst-i2i", inputs: { imageUrl: SOURCE } },
  { type: "reference-board", provider: "gpt-image-2-5-flare", inputs: {} },
] as const

function node(type: string, data: Record<string, unknown>): SimpleNode {
  return { id: "n1", type, data: { prompt: "a lighthouse", boardTemplate: "character/full-board", ...data } }
}

describe("GPT Image 2.5 at a 1K-only ratio, in a workflow", () => {
  it.each(CASES.flatMap((c) => ONE_K_ONLY.map((ratio) => [c.type, c.provider, ratio, c.inputs] as const)))(
    "%s on %s at %s: a 2K / 4K node is quoted, charged and sent at 1K",
    (type, provider, aspectRatio, inputs) => {
      for (const resolution of ["2K", "4K"]) {
        const n = node(type, { provider, aspectRatio, resolution })
        const built = buildPayload(n, "job-1", { ...inputs })
        expect(built.modelIdentifier).toBe(provider)
        expect(built.payload.resolution).toBe("1K")
        expect(getNodeModelIdentifier(n as never, { imageRefsWired: 0 })).toBe(built.modelIdentifier)
      }
    },
  )

  it.each(CASES.map((c) => [c.type, c.provider, c.inputs] as const))(
    "%s on %s at another ratio keeps its 2K price",
    (type, provider, inputs) => {
      const n = node(type, { provider, aspectRatio: "16:9", resolution: "2K" })
      const built = buildPayload(n, "job-1", { ...inputs })
      expect(built.modelIdentifier).toBe(`${provider}:2K`)
      expect(built.payload.resolution).toBe("2K")
      expect(getNodeModelIdentifier(n as never, { imageRefsWired: 0 })).toBe(built.modelIdentifier)
    },
  )
})
