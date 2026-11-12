// @test-units-by-name looks up only the generate-video-pro registry entry and the video model credit rows it names
/**
 * Every resolution Generate Video Pro offers renders AS NAMED, on every model
 * the node offers.
 *
 * A pro run renders the resolution its pricing echoes (the engine renders
 * `pricing.resolution`); a runner that normalizes its lever renders each such
 * catalog tier as named (`@nodaro/shared`'s video-resolution-billed-as-named
 * test). Both menus — the one `/v1/nodes` serves and the one the editor and a
 * published app show (`gvpOfferedResolutions`, `@nodaro/render-rules`) — are
 * held to that here, so a menu can never offer a tier a run renders as another.
 *
 * model_pricing lookups MISS, so `getModelCreditBaseCost` reads the real
 * STATIC_CREDIT_COSTS.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: { code: "PGRST116" } }),
        }),
      }),
    }),
  },
}))

import { NODE_REGISTRY } from "../../../lib/node-registry.js"
import { computeGenerateVideoProPricing } from "../generate-video-pro-credits.js"
import { invalidateModelPricingCache } from "../credits.js"
import { GVP_SUPPORTED_PROVIDERS } from "@nodaro/shared/models"
import { gvpOfferedResolutions, gvpRenderResolution, gvpRendersResolutionAsNamed } from "@nodaro/render-rules"

beforeEach(() => {
  invalidateModelPricingCache()
})

/** The tier a pro run renders when asked for `resolution`. */
async function rendered(provider: string, resolution: string): Promise<string> {
  const p = await computeGenerateVideoProPricing({ provider, resolution, durationSec: 8, renderMethod: "keyframes", aspectRatio: "16:9" })
  return p.resolution!.toLowerCase()
}

describe("gvpRenderResolution — the tier a pro run renders for the one it is asked", () => {
  it("snaps an unsupported tier to the nearest one, ties to the cheaper", () => {
    expect(gvpRenderResolution("veo3.1", "480p")).toBe("720p")
    expect(gvpRenderResolution("seedance-2-mini", "1080p")).toBe("720p")
    expect(gvpRenderResolution("seedance-2-mini", "4k")).toBe("720p")
    expect(gvpRenderResolution("seedance-2", "4k")).toBe("4k")
  })

  it("reads anything off the 480p / 720p / 1080p / 4k ladder as 480p, then snaps", () => {
    expect(gvpRenderResolution("vidu-q4", "540p")).toBe("720p")
    expect(gvpRenderResolution("vidu-q4", "2k")).toBe("720p")
    expect(gvpRenderResolution("gemini-omni-flash-1-2", "360p")).toBe("720p")
    expect(gvpRenderResolution("pixverse-v6-max", "360p")).toBe("720p")
    expect(gvpRenderResolution("pixverse-v6-max", "540p")).toBe("720p")
    expect(gvpRenderResolution("pixverse-v6-max", "4k")).toBe("1080p")
  })

  it("MiniMax Hailuo 3 keeps its own two values", () => {
    expect(gvpRenderResolution("minimax-h3", "768P")).toBe("768P")
    expect(gvpRenderResolution("minimax-h3", "720p")).toBe("2K")
    expect(gvpRenderResolution("minimax-h3", "2K")).toBe("2K")
  })

  it("the offered tiers per model", () => {
    expect(gvpOfferedResolutions("vidu-q4")).toEqual(["720p", "1080p", "4k"])
    expect(gvpOfferedResolutions("gemini-omni-flash-1-2")).toEqual(["720p", "1080p", "4k"])
    expect(gvpOfferedResolutions("pixverse-v6-max")).toEqual(["720p", "1080p"])
    expect(gvpOfferedResolutions("minimax-h3")).toEqual(["2K", "768P"])
    expect(gvpOfferedResolutions("seedance-2")).toEqual(["480p", "720p", "1080p", "4k"])
  })
})

describe("Generate Video Pro's resolution menus offer only what renders", () => {
  it("the editor's and a published app's menu: each catalog tier it keeps renders as named", async () => {
    for (const provider of GVP_SUPPORTED_PROVIDERS) {
      const offered = gvpOfferedResolutions(provider)
      expect(offered.length, provider).toBeGreaterThan(0)
      for (const r of offered) expect(await rendered(provider, r), `${provider} ${r}`).toBe(r.toLowerCase())
    }
  })

  it("the menu /v1/nodes serves: each tier, sent as its wire value, renders as that value", async () => {
    const d = NODE_REGISTRY.find((n) => n.type === "generate-video-pro")!
    for (const provider of d.providers!) {
      for (const r of d.providerResolutions![provider]!) {
        const sent = d.providerResolutionWire?.[provider]?.[r] ?? r
        expect(await rendered(provider, sent), `${provider} ${r}`).toBe(sent.toLowerCase())
      }
    }
  })

  it("the tiers dropped from the menus are exactly those a run renders at 720p", async () => {
    for (const [provider, dropped] of [["vidu-q4", ["540p", "2k"]], ["gemini-omni-flash-1-2", ["360p"]], ["pixverse-v6-max", ["360p", "540p"]]] as const) {
      for (const r of dropped) {
        expect(gvpRendersResolutionAsNamed(provider, r), `${provider} ${r}`).toBe(false)
        // A node that already carries one keeps running exactly as before.
        expect(await rendered(provider, r), `${provider} ${r}`).toBe("720p")
      }
    }
  })
})
