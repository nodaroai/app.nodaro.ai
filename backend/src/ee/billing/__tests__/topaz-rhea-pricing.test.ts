// @test-units-by-name prices the node types it names (upload-video, video-upscale) and reads only the Topaz Rhea rows and catalog entry
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Topaz Rhea on Video Upscale (decided 2026-11-24): the factor that brings the
 * source's short side to the target (clamped to 1–4), and a flat price per
 * second of the clip by the target — the clip's EXACT length (in 1/64 s steps,
 * rounded up), the total rounded up once to a whole credit, marked up once. The workflow estimate a plugin reads (an upload wired
 * into a Video Upscale on `topaz-rhea`) names the same row and the same units
 * the route's plan holds and charges.
 */

vi.mock("../../../lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "order", "range", "limit", "in", "is", "not", "gt", "lt"]) chain[m] = () => chain
  chain.single = async () => ({ data: null, error: { code: "PGRST116", message: "no rows" } })
  chain.maybeSingle = async () => ({ data: null, error: null })
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
  return { supabase: { from: () => chain, rpc: async () => ({ data: null, error: null }) } }
})
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 0 }) }))
vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => true,
}))
const probe = vi.hoisted(() => ({ result: undefined as unknown }))
vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeVideoSource: vi.fn(async () => probe.result),
}))

// The outside-input copy: the clip is "copied" to STORED and its inspect run on a local path, as the real copy does.
const copied = vi.hoisted(() => ({ urls: [] as string[] }))
vi.mock("../../../lib/outside-input-copy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/outside-input-copy.js")>()
  const run = async (url: string, opts: { inspect: (p: string, s: AbortSignal) => Promise<unknown> }) => {
    copied.urls.push(url)
    try {
      await opts.inspect("/tmp/outside-input/input", new AbortController().signal)
    } catch (reason) {
      throw new actual.OutsideInputInspectRefusedError(reason)
    }
  }
  return {
    ...actual,
    copyOutsideInput: vi.fn(async (url: string, opts: { inspect: (p: string, s: AbortSignal) => Promise<unknown> }) => {
      await run(url, opts)
      return { url: "https://cdn.example/tmp/provider-input/copy.mp4", bytes: 1_000_000, copied: true }
    }),
    inspectOutsideInput: vi.fn(async (url: string, opts: { inspect: (p: string, s: AbortSignal) => Promise<unknown> }) => {
      await run(url, opts)
      return { bytes: 1_000_000 }
    }),
  }
})

import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { VIDEO_UPSCALE_PROVIDERS } from "@nodaro/shared/models"
import {
  TOPAZ_RHEA_CREDIT_IDS,
  topazRheaBilledSec,
  topazRheaEstimateUnits,
  topazRheaTargetOf,
  topazRheaUpscaleFactor,
} from "@nodaro/render-rules"
import { STATIC_CREDIT_COSTS, chargedCredits, chargedPriceTableFrom, getNodeModelIdentifier, graphPricingUnits } from "../credits.js"
import { parseRateQuoteCreditId } from "../../../lib/unit-quote-rates.js"
import { planTopazRheaUpscale, TopazRheaAlreadyAtTargetError, TopazRheaTooLongError, topazRheaBaseCredits } from "../../../lib/topaz-rhea-plan.js"

// A 10% markup fixture, with no model_pricing rows: the static rows price it.
const prices = chargedPriceTableFrom(new Map(), { cost_markup_percent: 10 } as never)
const charged = (target: keyof typeof TOPAZ_RHEA_CREDIT_IDS, clipSec: number): number | undefined =>
  chargedCredits(prices, TOPAZ_RHEA_CREDIT_IDS[target], topazRheaBilledSec(clipSec))

describe("Topaz Rhea's factor: the source's short side reaches the target", () => {
  it.each([
    ["landscape 854×480 → 720p", 854, 480, "720p", 1.5],
    ["portrait 480×854 → 720p", 480, 854, "720p", 1.5],
    ["landscape 1280×720 → 1080p", 1280, 720, "1080p", 1.5],
    ["portrait 720×1280 → 1080p", 720, 1280, "1080p", 1.5],
    ["landscape 1920×1080 → 4K", 1920, 1080, "4k", 2],
    ["portrait 1080×1920 → 4K", 1080, 1920, "4k", 2],
    ["21:9 1680×720 → 4K", 1680, 720, "4k", 3],
    ["480p → 1080p", 854, 480, "1080p", 2.25],
    ["odd 486×864 → 720p (rounded up, never short)", 486, 864, "720p", 1.4815],
    ["odd 1279×719 → 1080p", 1279, 719, "1080p", 1.5021],
    ["540 → 4K is exactly 4", 960, 540, "4k", 4],
    ["360×640 → 4K is clamped to 4", 640, 360, "4k", 4],
    ["a hair under the target is 1.0x", 1280, 719, "720p", 1.0014],
  ] as const)("%s = %s", (_name, width, height, target, factor) => {
    expect(topazRheaUpscaleFactor({ width, height }, target)).toBe(factor)
  })

  it("a factor rounded up always reaches the target's short side", () => {
    for (let short = 200; short < 2160; short += 7) {
      for (const target of ["720p", "1080p", "4k"] as const) {
        const f = topazRheaUpscaleFactor({ width: short * 2, height: short }, target)
        if (f === undefined || f === 4) continue
        expect(short * f, `${short} → ${target}`).toBeGreaterThanOrEqual({ "720p": 720, "1080p": 1080, "4k": 2160 }[target])
      }
    }
  })

  it("a source at or above the target has nothing to upscale", () => {
    expect(topazRheaUpscaleFactor({ width: 1280, height: 720 }, "720p")).toBeUndefined()
    expect(topazRheaUpscaleFactor({ width: 720, height: 1280 }, "720p")).toBeUndefined()
    expect(topazRheaUpscaleFactor({ width: 3840, height: 2160 }, "1080p")).toBeUndefined()
  })

  it("the target: 720p / 1080p / 4k as sent, unset = 1080p, anything else refused", () => {
    expect(topazRheaTargetOf(undefined)).toBe("1080p")
    expect(topazRheaTargetOf("")).toBe("1080p")
    expect(topazRheaTargetOf("4k")).toBe("4k")
    expect(topazRheaTargetOf("2k")).toBeUndefined()
    expect(topazRheaTargetOf("4K")).toBeUndefined()
  })
})

describe("Topaz Rhea's price", () => {
  it("each target's row prices one second", () => {
    expect(STATIC_CREDIT_COSTS[TOPAZ_RHEA_CREDIT_IDS["720p"]]).toBe(5)
    expect(STATIC_CREDIT_COSTS[TOPAZ_RHEA_CREDIT_IDS["1080p"]]).toBe(10)
    expect(STATIC_CREDIT_COSTS[TOPAZ_RHEA_CREDIT_IDS["4k"]]).toBe(30)
  })

  it.each([
    ["720p", 4, 22], ["1080p", 4, 44], ["4k", 4, 132],
    ["720p", 10, 55], ["1080p", 10, 110], ["4k", 10, 330],
    ["720p", 30, 165], ["1080p", 30, 330], ["4k", 30, 990],
  ] as const)("%s, a %i s clip is charged %i", (target, sec, credits) => {
    expect(charged(target, sec)).toBe(credits)
  })

  it("bills the exact length, in 1/64 s steps rounded up (a 4 s take one frame long is billed 4.046875 s, not 5)", () => {
    expect(topazRheaBilledSec(97 / 24)).toBe(4.046875)
    expect(topazRheaBilledSec(4.04)).toBe(4.046875)
    expect(topazRheaBilledSec(10.04)).toBe(10.046875)
    expect(topazRheaBilledSec(4)).toBe(4)
    // A container's length (a clip whose stream length could not be read) less its 0.15 s allowance first.
    expect(topazRheaBilledSec(10.15, "container")).toBe(10)
    expect(topazRheaBilledSec(10.16, "container")).toBe(10.015625)
    expect(charged("1080p", 97 / 24)).toBeLessThan(charged("1080p", 5)!)
  })

  it("its floor: the shortest clip is billed one step, at least one whole credit at every target", () => {
    expect(topazRheaBilledSec(0)).toBe(1 / 64)
    expect(topazRheaBilledSec(0.001)).toBe(1 / 64)
    expect(topazRheaBilledSec(0.1, "container")).toBe(1 / 64)
    for (const target of ["720p", "1080p", "4k"] as const) expect(charged(target, 0.001)).toBeGreaterThanOrEqual(1)
  })

  it("the row × the steps is exact in binary: never a hair over a whole credit by float noise", () => {
    for (let steps = 1; steps <= 64 * 60; steps++) {
      for (const row of [5, 10, 30]) {
        const product = row * (steps / 64)
        expect(product * 64).toBe(row * steps)
      }
    }
  })

  it.each([
    ["720p", 4.04, 24], ["1080p", 4.04, 46], ["4k", 4.04, 135],
    ["720p", 10.04, 57], ["1080p", 10.04, 112], ["4k", 10.04, 333],
  ] as const)("%s, a %f s clip is charged %i (its exact length)", (target, sec, credits) => {
    expect(charged(target, sec)).toBe(credits)
  })

  it("the catalog lists the provider, hidden from the editor, with the static rows", () => {
    expect(VIDEO_UPSCALE_PROVIDERS).toContain("topaz-rhea")
    const entry = MODEL_CATALOG["topaz-rhea"]!
    expect(entry.pickerHidden).toBe(true)
    for (const id of Object.values(TOPAZ_RHEA_CREDIT_IDS)) {
      expect(entry.pricing.find((r) => r.identifier === id)?.credits).toBe(STATIC_CREDIT_COSTS[id])
    }
  })

  it("a whole-run quote id prices the plan's fractional seconds", () => {
    const id = TOPAZ_RHEA_CREDIT_IDS["4k"]
    expect(parseRateQuoteCreditId(`${id}:10u`)).toEqual({ rateId: id, units: 10 })
    expect(parseRateQuoteCreditId(`${id}:4.046875u`)).toEqual({ rateId: id, units: 4.046875 })
  })

  it("an estimate with no known length prices a 10 s clip; a known one is billed as a run bills it", () => {
    expect(topazRheaEstimateUnits(undefined)).toBe(10)
    expect(topazRheaEstimateUnits(null)).toBe(10)
    expect(topazRheaEstimateUnits(8.2)).toBe(8.203125)
  })
})

const URL = "https://cdn.example/take.mp4"
const CTX = { userId: "user-1" }
type Node = { id: string; type: string; data: Record<string, unknown> }

/** The plugin's estimate graph: the take as an upload, wired into a Video Upscale on Topaz Rhea. */
function estimateGraph(sec: number, target: string | undefined): { nodes: Node[]; edges: Array<{ source: string; target: string; targetHandle: string }> } {
  return {
    nodes: [
      { id: "take", type: "upload-video", data: { url: URL, duration: sec, fps: 24, metadata: { width: 854, height: 480 } } },
      { id: "x", type: "video-upscale", data: { provider: "topaz-rhea", ...(target ? { targetResolution: target } : {}) } },
    ],
    edges: [{ source: "take", target: "x", targetHandle: "video" }],
  }
}

describe("the estimate names what the run holds and is charged", () => {
  beforeEach(() => {
    probe.result = undefined
  })

  for (const target of ["720p", "1080p", "4k"] as const) {
    for (const sec of [4, 97 / 24, 10, 15, 30]) {
      it(`${target}, a ${sec.toFixed(2)} s take`, async () => {
        const { nodes, edges } = estimateGraph(sec, target)
        const units = graphPricingUnits(nodes[1]!, nodes, edges, new Set(["x"]))
        const id = getNodeModelIdentifier(nodes[1]!, {})
        probe.result = { width: 854, height: 480, durationSeconds: sec, videoDurationSeconds: sec, fps: 24 }
        const plan = await planTopazRheaUpscale(URL, target, CTX)
        expect(id).toBe(plan.creditId)
        expect(units).toBe(plan.billedSec)
        // The route's hold (base, before the markup) is the row × the same units.
        expect(await topazRheaBaseCredits(plan)).toBe(Math.ceil(STATIC_CREDIT_COSTS[plan.creditId]! * plan.billedSec))
        expect(chargedCredits(prices, id, units)).toBe(charged(target, sec))
      })
    }
  }

  it("a node with no target is quoted at 1080p, the run's default", () => {
    const { nodes } = estimateGraph(10, undefined)
    expect(getNodeModelIdentifier(nodes[1]!, {})).toBe(TOPAZ_RHEA_CREDIT_IDS["1080p"])
  })
})

describe("the clip's copy is size-scaled, inside the copy slot's hold", () => {
  it("a run and a quote both download under the size-scaled rule, never the flat 120 s", async () => {
    const { copyOutsideInput, inspectOutsideInput, OUTSIDE_INPUT_SIZE_SCALED_DOWNLOAD, OUTSIDE_INPUT_MAX_HOLD_MS } = await import("../../../lib/outside-input-copy.js")
    probe.result = { width: 854, height: 480, durationSeconds: 10, videoDurationSeconds: 10, fps: 24 }
    vi.mocked(copyOutsideInput).mockClear()
    vi.mocked(inspectOutsideInput).mockClear()
    await planTopazRheaUpscale(URL, "1080p", CTX)
    await planTopazRheaUpscale(URL, "1080p", { ...CTX, quote: true })
    expect(vi.mocked(copyOutsideInput).mock.calls[0]![1]).toMatchObject({ downloadRate: OUTSIDE_INPUT_SIZE_SCALED_DOWNLOAD })
    expect(vi.mocked(inspectOutsideInput).mock.calls[0]![1]).toMatchObject({ downloadRate: OUTSIDE_INPUT_SIZE_SCALED_DOWNLOAD })
    // The download's ceiling ends inside the 5-min hold that bounds the whole step.
    expect(OUTSIDE_INPUT_SIZE_SCALED_DOWNLOAD.maxMs).toBeLessThan(OUTSIDE_INPUT_MAX_HOLD_MS)
  })
})

describe("the plan refuses before anything is held", () => {
  it("a source already at or above the target", async () => {
    probe.result = { width: 1920, height: 1080, durationSeconds: 5, videoDurationSeconds: 5, fps: 30 }
    await expect(planTopazRheaUpscale(URL, "1080p", CTX)).rejects.toBeInstanceOf(TopazRheaAlreadyAtTargetError)
    await expect(planTopazRheaUpscale(URL, "1080p", CTX)).rejects.toMatchObject({
      code: "video_already_at_target",
      message: "This clip is already 1920×1080, at or above 1080p — there is nothing to upscale. Choose a larger target resolution.",
    })
  })

  it("a source past the output limit, naming the longest it takes", async () => {
    // 1080 → 4K at 2×: 3840×2160×30 fps is ~0.249 GP a second, so 10 GP is 40 s.
    probe.result = { width: 1920, height: 1080, durationSeconds: 41, videoDurationSeconds: 41, fps: 30 }
    await expect(planTopazRheaUpscale(URL, "4k", CTX)).rejects.toBeInstanceOf(TopazRheaTooLongError)
    await expect(planTopazRheaUpscale(URL, "4k", CTX)).rejects.toMatchObject({ code: "video_too_long", maxSec: 40 })
    probe.result = { width: 1920, height: 1080, durationSeconds: 40, videoDurationSeconds: 40, fps: 30 }
    await expect(planTopazRheaUpscale(URL, "4k", CTX)).resolves.toMatchObject({ upscaleFactor: 2, outputWidth: 3840, outputHeight: 2160, billedSec: 40 })
  })

  it("copies the clip into our storage first: the plan sends the copy it measured, never the caller's link (a quote stores nothing)", async () => {
    copied.urls.length = 0
    probe.result = { width: 854, height: 480, durationSeconds: 4, videoDurationSeconds: 4, fps: 24 }
    const plan = await planTopazRheaUpscale("https://elsewhere.example/clip.mp4", "720p", CTX)
    expect(copied.urls).toEqual(["https://elsewhere.example/clip.mp4"])
    expect(plan.videoUrl).toBe("https://cdn.example/tmp/provider-input/copy.mp4")
    const quoted = await planTopazRheaUpscale("https://elsewhere.example/clip.mp4", "720p", { ...CTX, quote: true })
    expect(quoted.videoUrl).toBe("https://elsewhere.example/clip.mp4")
  })

  it("measures the DISPLAYED frame: a clip stored 1920×1080 with a 90° rotation tag is portrait", async () => {
    probe.result = { width: 1920, height: 1080, rotation: 90, durationSeconds: 5, videoDurationSeconds: 5, fps: 30 }
    await expect(planTopazRheaUpscale(URL, "4k", CTX)).resolves.toMatchObject({ upscaleFactor: 2, outputWidth: 2160, outputHeight: 3840 })
    await expect(planTopazRheaUpscale(URL, "1080p", CTX)).rejects.toMatchObject({ code: "video_already_at_target", message: expect.stringContaining("1080×1920") })
  })

  it("an unreadable source", async () => {
    const { probeVideoSource } = await import("../../../providers/video/ffmpeg-utils.js")
    vi.mocked(probeVideoSource).mockRejectedValueOnce(new Error("ffprobe failed: Invalid data found when processing input"))
    await expect(planTopazRheaUpscale(URL, "1080p", CTX)).rejects.toMatchObject({ name: "TopazVideoSourceUnreadableError" })
  })
})
