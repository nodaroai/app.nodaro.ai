/**
 * Generate Video Pro in the editor: the display estimate prices each segment at
 * the audio its model renders (PixVerse V6 Max: the node's `generateAudio`, on
 * by default; Kling 3.0: its sound, always) — the backend's `segmentCost`
 * twin — and every resolution menu offers only the tiers a pro run renders as
 * named, while a node already carrying another keeps it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const cache = vi.hoisted(() => new Map<string, number>())
vi.mock("@/ee/hooks/use-model-credits", () => ({
  getCachedCredits: (id: string) => cache.get(id),
  getCachedVideoProCredits: () => undefined,
}))

import { estimateGenerateVideoProCredits } from "../types"
import { GVP_ANCHOR_CHOICES, GVP_SUPPORTED_PROVIDERS, resolveGvpAnchorWire } from "@nodaro/shared/models"
import { gvpAnchorChoicesFor, gvpRenderResolution, gvpSegmentAudio } from "@nodaro/render-rules"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import {
  GVP_RETAINED_RESOLUTION_OPTIONS,
  gvpShownResolution,
  gvpVideoResolutionOptions,
  getVideoResolutionOptions,
} from "@/components/editor/config-panels/model-options"
import { getQuickConfigs, quickConfigSnapPatch, resolveQuickConfigOptions } from "@/components/nodes/node-quick-configs"
import type { GenerateVideoProNodeData } from "@/types/nodes"

const ID = "pixverse-v6-max"
const FEE = 50

beforeEach(() => {
  cache.clear()
  cache.set("generate-video-pro", FEE)
  // A few seeded rows (base credits; the estimate reads whatever the cache holds).
  cache.set(`${ID}:8s:720p:audio`, 240)
  cache.set(`${ID}:8s:720p`, 180)
  cache.set(`${ID}:8s:1080p:audio`, 450)
  cache.set(`${ID}:8s:1080p`, 360)
})

function gvp(data: Partial<GenerateVideoProNodeData>): GenerateVideoProNodeData {
  return { label: "Generate Video Pro", prompt: "a lighthouse in a storm", provider: ID, duration: 24, resolution: "720p", ...data } as GenerateVideoProNodeData
}

describe("the editor's Generate Video Pro estimate on PixVerse V6 Max", () => {
  it("prices every segment WITH audio when the node leaves generateAudio unset or on", () => {
    // 24 s on a 15 s model: 2 segments, ~12 s each — the cache is keyed by the
    // representative length, so seed it for that length.
    cache.set(`${ID}:12s:720p:audio`, 360)
    cache.set(`${ID}:12s:720p`, 270)
    expect(estimateGenerateVideoProCredits(gvp({}))).toBe(FEE + 2 * 360)
    expect(estimateGenerateVideoProCredits(gvp({ generateAudio: true }))).toBe(FEE + 2 * 360)
  })

  it("prices the silent rows when the node turns audio off", () => {
    cache.set(`${ID}:12s:720p:audio`, 360)
    cache.set(`${ID}:12s:720p`, 270)
    expect(estimateGenerateVideoProCredits(gvp({ generateAudio: false }))).toBe(FEE + 2 * 270)
  })

  it("a single-segment run quotes its one row at the same audio", () => {
    expect(estimateGenerateVideoProCredits(gvp({ duration: 8 }))).toBe(240)
    expect(estimateGenerateVideoProCredits(gvp({ duration: 8, generateAudio: false }))).toBe(180)
    expect(estimateGenerateVideoProCredits(gvp({ duration: 8, resolution: "1080p", generateAudio: true }))).toBe(450)
  })
})

describe("Generate Video Pro's anchor choices on PixVerse V6 Max", () => {
  it("has no reference choice, and a stored one is sent as Auto", () => {
    expect(gvpAnchorChoicesFor(ID)).not.toContain("reference")
    expect(resolveGvpAnchorWire("reference", ID)).toBeUndefined()
    expect(gvpAnchorChoicesFor("seedance-2")).toContain("reference")
    expect([...gvpAnchorChoicesFor(ID)]).toEqual(["auto", "start-end", "start-only"])
    expect([...gvpAnchorChoicesFor("seedance-2")]).toEqual([...GVP_ANCHOR_CHOICES])
    expect([...gvpAnchorChoicesFor(undefined)]).toEqual([...GVP_ANCHOR_CHOICES])
  })
})

describe("the editor's Generate Video Pro estimate on Kling 3.0 (an API-named model)", () => {
  it("quotes its sound rows whatever generateAudio says — the audio it renders", () => {
    cache.set("kling-3.0:10s:audio", 1000)
    cache.set("kling-3.0:10s", 680)
    for (const generateAudio of [true, false, undefined]) {
      expect(estimateGenerateVideoProCredits(gvp({ provider: "kling-3.0", duration: 8, ...(generateAudio === undefined ? {} : { generateAudio }) })), String(generateAudio)).toBe(1000)
    }
  })
})

describe("Generate Video Pro's resolution menu", () => {
  it("offers only the tiers a pro run renders as named, on every model", () => {
    for (const p of GVP_SUPPORTED_PROVIDERS) {
      const menu = gvpVideoResolutionOptions(p)?.map((o) => o.value) ?? []
      expect(menu.length, p).toBeGreaterThan(0)
      // The run renders each one at the tier it names (the rule the pro pricing echoes).
      for (const r of menu) expect(gvpRenderResolution(p, r), `${p} ${r}`).toBe(r)
      // And nothing the catalog lists that renders as named is left out.
      expect(menu, p).toEqual((getVideoResolutionOptions(p) ?? []).map((o) => o.value).filter((r) => gvpRenderResolution(p, r) === r))
    }
  })

  it("drops the catalog tiers a run renders at 720p", () => {
    expect(gvpVideoResolutionOptions(ID)?.map((o) => o.value)).toEqual(["720p", "1080p"])
    expect(gvpVideoResolutionOptions("vidu-q4")?.map((o) => o.value)).toEqual(["720p", "1080p", "4k"])
    expect(gvpVideoResolutionOptions("gemini-omni-flash-1-2")?.map((o) => o.value)).toEqual(["720p", "1080p", "4k"])
    expect(gvpVideoResolutionOptions("minimax-h3")).toEqual(getVideoResolutionOptions("minimax-h3"))
    expect(gvpVideoResolutionOptions("seedance-2")).toEqual(getVideoResolutionOptions("seedance-2"))
  })
})

describe("a node already carrying a resolution the menu no longer offers", () => {
  const strip = getQuickConfigs("generate-video-pro").find((c) => c.field === "resolution")!

  it("is retained by the run strip — never snapped away", () => {
    expect(GVP_RETAINED_RESOLUTION_OPTIONS.map((o) => o.value).sort()).toEqual(["2k", "360p", "540p"])
    for (const [provider, value] of [["vidu-q4", "540p"], ["vidu-q4", "2k"], ["gemini-omni-flash-1-2", "360p"], [ID, "540p"]] as const) {
      const data = { provider, resolution: value }
      const options = resolveQuickConfigOptions(strip, data)
      expect(options.map((o) => o.value), `${provider} ${value}`).not.toContain(value)
      expect(quickConfigSnapPatch(strip, value, options, data), `${provider} ${value}`).toBeUndefined()
    }
  })

  it("reads, in the panel and a published app, as the tier it runs at", () => {
    expect(gvpShownResolution("vidu-q4", "540p")).toBe("720p")
    expect(gvpShownResolution("vidu-q4", "2k")).toBe("720p")
    expect(gvpShownResolution("gemini-omni-flash-1-2", "360p")).toBe("720p")
    expect(gvpShownResolution(ID, "360p")).toBe("720p")
    expect(gvpShownResolution("vidu-q4", "1080p")).toBe("1080p")
    expect(gvpShownResolution("vidu-q4", undefined)).toBeUndefined()
  })
})

describe("the estimate of a node carrying a tier the run renders as another", () => {
  // Every row a quote could read, at the stored tier (cheap) and at 720p (dear),
  // so a quote read at the stored tier would come out far below the bill.
  function seed(provider: string, stored: string): void {
    for (let d = 1; d <= 16; d++) {
      for (const audio of [true, false]) {
        for (const mode of ["image-to-video", "text-to-video"] as const) {
          cache.set(buildVideoCreditModelIdentifier(provider, d, { sound: audio }, mode, undefined, stored, false), 10 * d)
          cache.set(buildVideoCreditModelIdentifier(provider, d, { sound: audio }, mode, undefined, "720p", false), 100 * d)
        }
      }
    }
  }

  const CASES = [["vidu-q4", "540p"], ["vidu-q4", "2k"], ["gemini-omni-flash-1-2", "360p"], [ID, "360p"], [ID, "540p"]] as const

  it("quotes a single-segment run at the 720p row it is billed at", () => {
    for (const [provider, stored] of CASES) {
      seed(provider, stored)
      const billed = cache.get(buildVideoCreditModelIdentifier(provider, 8, gvpSegmentAudio(undefined), "text-to-video", undefined, "720p", false))!
      expect(estimateGenerateVideoProCredits(gvp({ provider, duration: 8, resolution: stored })), `${provider} ${stored}`).toBe(billed)
    }
  })

  it("quotes a multi-segment run at the 720p rows, the same as a node set to 720p", () => {
    for (const [provider, stored] of CASES) {
      seed(provider, stored)
      const at720 = estimateGenerateVideoProCredits(gvp({ provider, duration: 24, resolution: "720p" }))
      expect(at720, provider).toBeGreaterThan(FEE)
      expect(estimateGenerateVideoProCredits(gvp({ provider, duration: 24, resolution: stored })), `${provider} ${stored}`).toBe(at720)
    }
  })
})

