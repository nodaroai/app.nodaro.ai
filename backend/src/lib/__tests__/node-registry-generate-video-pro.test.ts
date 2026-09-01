import { describe, it, expect } from "vitest"
import { hasContiguousSegmentDurations } from "@nodaro/shared"
import { NODE_REGISTRY } from "../node-registry.js"

describe("generate-video-pro node registry", () => {
  it("is discoverable via GET /v1/nodes with video output, fee-base credit cost, and capabilities", () => {
    const d = NODE_REGISTRY.find((n) => n.type === "generate-video-pro")
    expect(d).toBeDefined()
    expect(d?.label).toBe("Generate Video Pro")
    expect(d?.category).toBe("ai-video")
    expect(d?.outputType).toBe("video")
    // Multi-mode fee-base only (STATIC_CREDIT_COSTS["generate-video-pro"] = 100) —
    // the real per-run cost is dynamic (see ee/billing/generate-video-pro-credits.ts).
    expect(d?.creditCost).toBe(100)
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

  it("providers are the DERIVED shared GVP list (every reference-image i2v SKU)", () => {
    const d = NODE_REGISTRY.find((n) => n.type === "generate-video-pro")
    // Single source of truth: packages/shared GVP_SUPPORTED_PROVIDERS, which is
    // derived from catalog capability (i2v + reference-image + durations) since
    // 2026-08-05 rather than hand-kept. Pinned literally here so a catalog edit
    // that changes the offered SKUs surfaces in the discovery API's own test
    // too. Ordering groups each family together with the default first.
    expect(d?.providers).toEqual([
      "seedance-2",
      "seedance-2-fast",
      "seedance-2-mini",
      "seedance-2-5",
      "minimax-h3",
      "veo3",
      "veo3.1",
      "veo3_lite",
      "gemini-omni-video",
      "gemini-omni-flash",
      "grok-i2v",
      "wan-3",
      "wan-3-prime",
      "happyhorse-ref2v",
    ])
    // kling-3-omni is deliberately absent: it passes every capability check
    // but has no working dispatch path (VIDEO_PROVIDERS_WITHOUT_DISPATCH).
    expect(d?.providers).not.toContain("kling-3-omni")
  })

  it("names the offered models whose duration menu is SPARSE", () => {
    // Consumers use this to say that such a model renders in fixed clip
    // lengths, so its parts cannot land exactly on the scene cuts. Derived
    // from the catalog, never hand-kept — same rule as `providers` above.
    const d = NODE_REGISTRY.find((n) => n.type === "generate-video-pro")
    expect(d?.sparseProviders).toEqual([
      "veo3",
      "veo3.1",
      "veo3_lite",
      "gemini-omni-video",
      "gemini-omni-flash",
      "grok-i2v",
    ])
    // Every entry is actually offered, and actually sparse...
    for (const id of d!.sparseProviders!) {
      expect(d!.providers).toContain(id)
      expect(hasContiguousSegmentDurations(id)).toBe(false)
    }
    // ...and nothing contiguous leaked in.
    for (const id of d!.providers!) {
      if (!d!.sparseProviders!.includes(id)) expect(hasContiguousSegmentDurations(id)).toBe(true)
    }
  })

  it("serves each model's supported resolutions, in the CLIENT's vocabulary", () => {
    // A client cannot derive this: its own catalog copy lags this repo's, which
    // is the same reason `providers` and `sparseProviders` are served rather
    // than computed. Consumers disable the tiers a model cannot render, so
    // nobody can pick one that the pricing would then clamp UP to the priciest
    // supported tier.
    const d = NODE_REGISTRY.find((n) => n.type === "generate-video-pro")
    const res = d?.providerResolutions
    expect(res).toBeDefined()
    // Every offered model has an entry, and every entry is a non-empty subset
    // of the vocabulary in low → high order.
    for (const id of d!.providers!) {
      const list = res![id]
      expect(list, id).toBeDefined()
      expect(list!.length, id).toBeGreaterThan(0)
      expect(list, id).toEqual(["480p", "720p", "1080p", "4k"].filter((r) => list!.includes(r)))
    }
    expect(res!["seedance-2"]).toEqual(["480p", "720p", "1080p", "4k"])
    expect(res!["seedance-2-fast"]).toEqual(["480p", "720p"])
    expect(res!["veo3"]).toEqual(["720p", "1080p", "4k"])
    expect(res!["grok-i2v"]).toEqual(["480p", "720p"])
    expect(res!["happyhorse-ref2v"]).toEqual(["720p", "1080p"])
  })

  it("gives Hailuo 3 both of its real tiers, and the strings that reach them", () => {
    // minimax-h3 speaks 768P/2K, not this vocabulary, and its normalizer picks
    // the cheaper tier ONLY for a literal "768p". Sending "720p" therefore gets
    // 2K silently, at 2K's price — so the tier list alone is not actionable and
    // the wire value has to be served with it.
    const d = NODE_REGISTRY.find((n) => n.type === "generate-video-pro")
    expect(d?.providerResolutions?.["minimax-h3"]).toEqual(["720p", "1080p"])
    expect(d?.providerResolutionWire?.["minimax-h3"]).toEqual({ "720p": "768P", "1080p": "2K" })
  })

  it("maps a wire value only where the model needs one", () => {
    // Every other model's own names ARE the vocabulary, so an entry would be
    // noise a client has to reason about for nothing.
    const d = NODE_REGISTRY.find((n) => n.type === "generate-video-pro")
    expect(Object.keys(d!.providerResolutionWire!)).toEqual(["minimax-h3"])
  })

  it("the wire mapping and the offered tiers cannot drift apart", () => {
    const d = NODE_REGISTRY.find((n) => n.type === "generate-video-pro")
    for (const [id, wire] of Object.entries(d!.providerResolutionWire!)) {
      expect(Object.keys(wire).sort(), id).toEqual([...d!.providerResolutions![id]!].sort())
    }
  })

  it("edit-video-pro stays Seedance-only (no minimax-h3 — no v2v mode / -ref axis)", () => {
    const d = NODE_REGISTRY.find((n) => n.type === "edit-video-pro")
    expect(d?.providers).toEqual(["seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2-5"])
    expect(d?.providers).not.toContain("minimax-h3")
  })

  it("exposes the expected inputSchema fields", () => {
    const d = NODE_REGISTRY.find((n) => n.type === "generate-video-pro")
    const keys = d?.inputSchema?.fields.map((f) => f.key) ?? []
    expect(keys).toEqual(
      expect.arrayContaining(["prompt", "provider", "duration", "aspectRatio", "resolution", "generateAudio", "noBackgroundMusic", "preferredSegmentSec", "segmentDurations"]),
    )
  })

  it("marks soundtrack capability for recast original-audio S1", () => {
    const d = NODE_REGISTRY.find((n) => n.type === "generate-video-pro")
    // The deployed plugin bundle accepts the `soundtrack` input; clients gate
    // their Music lever on this marker. The create schema strips unknown keys, so
    // an ungated client against an older bundle would silently lose the user's
    // track.
    expect(d?.soundtrack).toBe(true)
  })
})
