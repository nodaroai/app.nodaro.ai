import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, ResolvedInputs } from "../types.js"

// ---------------------------------------------------------------------------
// Helpers (mirrors payload-builder.test.ts)
// ---------------------------------------------------------------------------

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

// ---------------------------------------------------------------------------
// generate-image inpaint fields — must be carried through the orchestrator
// payload identically to the single-node /v1/generate-image route so a whole
// workflow run produces the same payload as a solo node run.
// ---------------------------------------------------------------------------

describe("buildPayload — generate-image inpaint fields", () => {
  const jobId = "job-1"

  it("carries baseImageUrl, maskUrl, strength, guidanceScale from node data", () => {
    const n = node("n1", "generate-image", {
      prompt: "x",
      provider: "gpt-image-2",
      baseImageUrl: "https://r2/b.png",
      maskUrl: "https://r2/m.png",
      strength: 0.6,
      guidanceScale: 8,
    })
    const result = buildPayload(n, jobId, {})
    expect(result.payload.baseImageUrl).toBe("https://r2/b.png")
    expect(result.payload.maskUrl).toBe("https://r2/m.png")
    expect(result.payload.strength).toBe(0.6)
    expect(result.payload.guidanceScale).toBe(8)
  })

  it("prefers wired resolvedInputs over node data for baseImageUrl and maskUrl", () => {
    const n = node("n1", "generate-image", {
      prompt: "x",
      baseImageUrl: "https://r2/data-base.png",
      maskUrl: "https://r2/data-mask.png",
    })
    const inputs: ResolvedInputs = {
      baseImageUrl: "https://r2/wired-base.png",
      maskUrl: "https://r2/wired-mask.png",
    }
    const result = buildPayload(n, jobId, inputs)
    expect(result.payload.baseImageUrl).toBe("https://r2/wired-base.png")
    expect(result.payload.maskUrl).toBe("https://r2/wired-mask.png")
  })

  it("leaves inpaint fields undefined when absent (non-inpaint generate)", () => {
    const n = node("n1", "generate-image", { prompt: "x" })
    const result = buildPayload(n, jobId, {})
    expect(result.payload.baseImageUrl).toBeUndefined()
    expect(result.payload.maskUrl).toBeUndefined()
    expect(result.payload.strength).toBeUndefined()
    expect(result.payload.guidanceScale).toBeUndefined()
  })
})
