import { describe, it, expect } from "vitest"
import { NODE_REGISTRY } from "../node-registry.js"

describe("generate-video-pro node registry", () => {
  it("is discoverable via GET /v1/nodes with video output, fee-base credit cost, and capabilities", () => {
    const d = NODE_REGISTRY.find((n) => n.type === "generate-video-pro")
    expect(d).toBeDefined()
    expect(d?.label).toBe("Generate Video Pro")
    expect(d?.category).toBe("ai-video")
    expect(d?.outputType).toBe("video")
    // Multi-mode fee-base only (STATIC_CREDIT_COSTS["generate-video-pro"] = 10) —
    // the real per-run cost is dynamic (see ee/billing/generate-video-pro-credits.ts).
    expect(d?.creditCost).toBe(10)
    expect(d?.capabilities).toEqual(["long-form", "auto-segmentation", "seamless-stitch"])
  })

  it("serves the duration cap via maxDurationSec (env-configurable, default 120)", () => {
    const d = NODE_REGISTRY.find((n) => n.type === "generate-video-pro")
    // No GENERATE_VIDEO_PRO_MAX_DURATION override in the test environment, so
    // this pins the same default the pricing helper and frontend fallback use
    // (ee/billing/generate-video-pro-credits.ts, GENERATE_VIDEO_PRO_MAX_DURATION_FALLBACK
    // in frontend/src/components/editor/config-panels/video-configs.tsx).
    expect(d?.maxDurationSec).toBe(120)
  })

  it("providers are the 3 Seedance-2-family variants (GVP_PROVIDERS)", () => {
    const d = NODE_REGISTRY.find((n) => n.type === "generate-video-pro")
    expect(d?.providers).toEqual(["seedance-2", "seedance-2-fast", "seedance-2-mini"])
  })

  it("exposes the expected inputSchema fields", () => {
    const d = NODE_REGISTRY.find((n) => n.type === "generate-video-pro")
    const keys = d?.inputSchema?.fields.map((f) => f.key) ?? []
    expect(keys).toEqual(
      expect.arrayContaining(["prompt", "provider", "duration", "aspectRatio", "resolution", "generateAudio"]),
    )
  })
})
