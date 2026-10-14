import { describe, it, expect, vi, beforeEach } from "vitest"
import { VIDEO_REF_VIDEO_DURATION_LIMITS } from "@nodaro/shared"

/**
 * The server's workflow estimates — the run estimate and the published-app
 * listing — price a Seedance run with reference video(s) the way the run
 * reserves it: `unit × (Σ clips + max(output, longest clip))`, through the same
 * quote arithmetic as `POST /v1/credits/seedance-ref-estimate`.
 *
 * A clip whose file the estimate knows (an upload the run sends as it is) is
 * probed — once per URL, then cached. A clip it cannot know (a generation's
 * output, an upload the app user replaces, no edges, the static base table)
 * is priced at the provider's worst case: never below the reserve.
 */

const probe = vi.hoisted(() => ({ durations: new Map<string, number>(), calls: [] as string[] }))
vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/ffmpeg-utils.js")>()),
  probeMediaDuration: async (url: string) => {
    probe.calls.push(url)
    const d = probe.durations.get(url)
    if (d === undefined) throw new Error("ffprobe failed")
    return d
  },
}))
vi.mock("../../../lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "order", "range", "limit", "in", "is", "not", "gt", "lt"]) chain[m] = () => chain
  chain.single = async () => ({ data: null, error: { code: "PGRST116", message: "no rows" } })
  chain.maybeSingle = async () => ({ data: null, error: null })
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
  return { supabase: { from: () => chain, rpc: async () => ({ data: null, error: null }) } }
})
const settings = vi.hoisted(() => ({ value: { cost_markup_percent: 40 } as Record<string, unknown> }))
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: async () => settings.value }))
vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => true,
}))

import { CreditsService, estimateWorkflowListingCredits, STATIC_CREDIT_COSTS } from "../credits.js"
import { seedance2RefVideoChargedQuote } from "../seedance2-ref-video-quote.js"
import { __forgetRefVideoClipLengths } from "../seedance-ref-video-estimate.js"

const CLIP = "https://cdn.example/clip-10.mp4"
const upload = { id: "clip", type: "upload-video", data: { url: CLIP } }
const wire = (target: string, targetHandle: string) => ({ source: "clip", target, sourceHandle: "video", targetHandle })
const gv = { id: "gv", type: "generate-video", data: { provider: "seedance-2-5", duration: 8, resolution: "720p" } }
const v2v = { id: "v2v", type: "video-to-video", data: { provider: "seedance-2-5", v2vResolution: "720p" } }
const cap = VIDEO_REF_VIDEO_DURATION_LIMITS["seedance-2-5"]!.maxSec

const quote = (args: { duration: number; durationsSec: number[]; unknownClips?: number }) =>
  seedance2RefVideoChargedQuote({ provider: "seedance-2-5", resolution: "720p", unknownClips: 0, ...args }).then((q) => q.credits)

beforeEach(() => {
  probe.durations = new Map([[CLIP, 10.04]])
  probe.calls = []
  __forgetRefVideoClipLengths()
})

describe("server run estimate — Seedance reference-video runs", () => {
  it("a Generate Video with an uploaded reference clip: the probed clip, priced as the reserve", async () => {
    const total = await CreditsService.estimateWorkflowCredits([upload, gv], [wire("gv", "videoReferences")])
    expect(total).toBe(await quote({ duration: 8, durationsSec: [10.04] }))
    expect(probe.calls).toEqual([CLIP])
  })

  it("Video to Video's Seedance edit lane: the source clip at Auto", async () => {
    const total = await CreditsService.estimateWorkflowCredits([upload, v2v], [wire("v2v", "video")])
    expect(total).toBe(await quote({ duration: -1, durationsSec: [10.04] }))
  })

  it("probes a URL once, then serves it from the cache", async () => {
    await CreditsService.estimateWorkflowCredits([upload, gv], [wire("gv", "videoReferences")])
    await CreditsService.estimateWorkflowCredits([upload, gv], [wire("gv", "videoReferences")])
    expect(probe.calls).toEqual([CLIP])
  })

  it("a clip a generation produces in this run: the worst case, never below the reserve", async () => {
    const producer = { id: "clip", type: "generate-video", data: { provider: "kling-3.0", duration: 5 } }
    const total = await CreditsService.estimateWorkflowCredits([producer, gv], [wire("gv", "videoReferences")])
    const producerOnly = await CreditsService.estimateWorkflowCredits([producer], [])
    expect(total - producerOnly).toBe(await quote({ duration: 8, durationsSec: [], unknownClips: 1 }))
  })

  it("the static base estimate (no probe) quotes the worst case at base prices", () => {
    const base = CreditsService.estimateWorkflowBaseCredits([upload, gv], [wire("gv", "videoReferences")])
    const perSec = STATIC_CREDIT_COSTS["seedance-2-5:8s:720p-ref"]! / 8
    expect(base - CreditsService.estimateWorkflowBaseCredits([upload])).toBe(Math.ceil(perSec * (cap + cap)))
  })
})

describe("published-app listing — Seedance reference-video runs", () => {
  it("a fixed uploaded clip is probed; one the app user replaces is the worst case", async () => {
    const fixed = await estimateWorkflowListingCredits([upload, gv], [wire("gv", "videoReferences")], { publishType: "app", replaceableMediaNodeIds: new Set() })
    expect(fixed.preview).toBe(await quote({ duration: 8, durationsSec: [10.04] }))
    const replaced = await estimateWorkflowListingCredits([upload, gv], [wire("gv", "videoReferences")], { publishType: "app", replaceableMediaNodeIds: new Set(["clip"]) })
    expect(replaced.preview).toBe(await quote({ duration: 8, durationsSec: [], unknownClips: 1 }))
  })
})
