// @test-units-by-name looks up only the image edit node types it builds (image-to-image, modify-image)
/**
 * A masked GPT Image 2.6 edit in a workflow run follows its photo, as on the
 * route: the run keeps the photo's shape whatever ratio the node names, and is
 * rendered and priced at the size nearest the photo. The photo's size is read
 * ahead of the build for such a node, and the workflow estimate prices the size
 * the photo's source node records.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { autoAspectSourceImageUrl } from "../source-image.js"
import type { SimpleNode } from "../types.js"
import { getNodeModelIdentifier } from "../../../ee/billing/credits.js"

const SRC = "https://media.nodaro.ai/src.png"
const MASK = "https://media.nodaro.ai/mask.png"
const node = (type: string, data: Record<string, unknown>): SimpleNode => ({ id: "n1", type, data })
const PHOTO_1K = { width: 768, height: 1024 }
const PHOTO_4000 = { width: 3000, height: 4000 }

describe("the photo's size is read for a masked node", () => {
  it("a masked 2.6 node naming a ratio needs its photo's size; without a mask it does not", () => {
    expect(autoAspectSourceImageUrl(node("modify-image", { provider: "gpt-image-2-6-flare-i2i", aspectRatio: "16:9", maskUrl: MASK }), { imageUrl: SRC })).toBe(SRC)
    expect(autoAspectSourceImageUrl(node("image-to-image", { provider: "gpt-image-2-6-sunburst-i2i", aspectRatio: "16:9" }), { imageUrl: SRC, maskUrl: MASK })).toBe(SRC)
    expect(autoAspectSourceImageUrl(node("modify-image", { provider: "gpt-image-2-6-flare-i2i", aspectRatio: "16:9" }), { imageUrl: SRC })).toBeUndefined()
    expect(autoAspectSourceImageUrl(node("modify-image", { provider: "ideogram-edit", aspectRatio: "16:9", maskUrl: MASK }), { imageUrl: SRC })).toBeUndefined()
  })
})

describe("a masked 2.6 node's run follows its photo", () => {
  for (const type of ["modify-image", "image-to-image"] as const) {
    for (const provider of ["gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst-i2i"] as const) {
      it(`${type} on ${provider}: a 1K photo asked at 4K runs, and is reserved, at 1K`, () => {
        const r = buildPayload(node(type, { prompt: "green sky", provider, resolution: "4K", maskUrl: MASK }), "j", { imageUrl: SRC }, "u", { sourceImage: PHOTO_1K })
        expect(r.payload).toMatchObject({ aspectRatio: "3:4", resolution: "1K" })
        expect(r.modelIdentifier).toBe(`${provider}:medium:1K:1ref`)
      })

      it(`${type} on ${provider}: a 4000 px photo asked at 1K runs at 4K, and a named 16:9 runs 3:4`, () => {
        const r = buildPayload(node(type, { prompt: "green sky", provider, aspectRatio: "16:9", resolution: "1K" }), "j", { imageUrl: SRC, maskUrl: MASK }, "u", { sourceImage: PHOTO_4000 })
        expect(r.payload).toMatchObject({ aspectRatio: "3:4", resolution: "4K" })
        expect(r.modelIdentifier).toBe(`${provider}:medium:4K:1ref`)
      })
    }
  }

  it("without a mask the node keeps its own ratio and size", () => {
    const r = buildPayload(node("modify-image", { prompt: "x", provider: "gpt-image-2-6-flare-i2i", aspectRatio: "16:9", resolution: "4K" }), "j", { imageUrl: SRC }, "u", { sourceImage: PHOTO_1K })
    expect(r.payload).toMatchObject({ aspectRatio: "16:9", resolution: "4K" })
    expect(r.modelIdentifier).toBe("gpt-image-2-6-flare-i2i:medium:4K:1ref")
  })
})

describe("the workflow estimate of a masked 2.6 node", () => {
  const data = { provider: "gpt-image-2-6-flare-i2i", resolution: "4K", maskUrl: MASK }
  it("is priced at the size nearest the photo its source records", () => {
    const id = getNodeModelIdentifier({ id: "n1", type: "modify-image", data } as never, { imageRefsWired: 0, sourceImage: PHOTO_1K, masked: true })
    expect(id).toBe("gpt-image-2-6-flare-i2i:medium:1K:1ref")
  })

  it("keeps the size asked when the photo's size is unknown", () => {
    expect(getNodeModelIdentifier({ id: "n1", type: "modify-image", data } as never, { imageRefsWired: 0 })).toBe("gpt-image-2-6-flare-i2i:medium:4K:1ref")
  })
})
