import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import type { ConnectedReference } from "@nodaro/shared"

/**
 * Per-provider reference cap in `buildImagePrompt`. The canvas enforces each
 * model's image-reference limit via handle-limits, but the direct API / MCP /
 * SDK path only Zod-caps `connectedReferences` at a flat 14. Without a cap in
 * the shared assembler, an over-cap caller would get `Image N` directives the
 * provider silently drops. The cap is applied UP FRONT (before numbering), so
 * directives and URLs stay in lock-step — never a binding past the limit.
 */

function manualRefs(n: number): ConnectedReference[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    defaultName: `ref${i}`,
    source: "manual" as const,
    url: `https://r2/ref-${i}.png`,
    description: `reference ${i}`,
  }))
}

describe("buildImagePrompt — per-provider reference cap (API/MCP over-cap guard)", () => {
  it("caps structured references to the provider's image-ref limit; no Image N past it (flux-i2i = 4)", () => {
    const result = buildImagePrompt({
      prompt: "a composite scene",
      provider: "flux-i2i", // REF_IMAGE_MAX_LIMITS = 4
      connectedReferences: manualRefs(6),
    })
    expect(result.referenceImageUrls).toHaveLength(4)
    expect(result.prompt).not.toContain("Image 5")
    expect(result.prompt).not.toContain("Image 6")
  })

  it("flat referenceImageUrls consume the budget before structured refs (nano-banana-pro = 8)", () => {
    const flat = Array.from({ length: 6 }, (_, i) => `https://r2/flat-${i}.png`)
    const result = buildImagePrompt({
      prompt: "scene",
      provider: "nano-banana-pro", // cap 8
      referenceImageUrls: flat,
      connectedReferences: manualRefs(6),
    })
    // 6 flat (numbered first) + 2 structured = 8; the other 4 structured drop.
    expect(result.referenceImageUrls).toHaveLength(8)
    expect(result.prompt).not.toContain("Image 9")
  })

  it("does not cap when the ref count is within the provider's limit (nano-banana-pro = 8)", () => {
    const result = buildImagePrompt({
      prompt: "scene",
      provider: "nano-banana-pro",
      connectedReferences: manualRefs(3),
    })
    expect(result.referenceImageUrls).toHaveLength(3)
  })
})
