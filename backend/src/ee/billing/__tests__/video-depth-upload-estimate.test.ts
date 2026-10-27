// @test-units-by-name prices the node types it names (upload-video, video-depth)
import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The server's workflow estimates price a Video Depth fed by an upload at the
 * upload's probed length — the tier the run's reservation measures — instead
 * of the provider's ceiling row. A clip the estimate cannot read, or an upload
 * the app user replaces, stays at the ceiling: never below the reserve.
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
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 40 }) }))
vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => true,
}))

import { CreditsService, chargedCredits, estimateWorkflowListingCredits, getChargedPriceTable } from "../credits.js"
import { __forgetUploadClipLengths } from "../upload-clip-lengths.js"

const CLIP = "https://cdn.example/clip-12.mp4"
const upload = { id: "clip", type: "upload-video", data: { url: CLIP } }
const depth = (data: Record<string, unknown> = {}) => ({ id: "vd", type: "video-depth", data })
const wires = [{ source: "clip", target: "vd", sourceHandle: "video", targetHandle: "video" }]
const charged = async (id: string) => chargedCredits(await getChargedPriceTable(), id)!
const depthPart = async (nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>) =>
  (await CreditsService.estimateWorkflowCredits(nodes, wires)) - (await CreditsService.estimateWorkflowCredits([upload], []))

beforeEach(() => {
  probe.durations = new Map([[CLIP, 12]])
  probe.calls = []
  __forgetUploadClipLengths()
})

describe("server run estimate — Video Depth on an uploaded clip", () => {
  it("a 12 s upload quotes the 15 s tier the run reserves, not the 300 s ceiling", async () => {
    expect(await depthPart([upload, depth()])).toBe(await charged("video-depth-anything:15s"))
    expect(probe.calls).toEqual([CLIP])
  })

  it("on the Replicate provider, its own tier", async () => {
    probe.durations.set(CLIP, 40)
    expect(await depthPart([upload, depth({ provider: "depth-anything-frames" })])).toBe(await charged("depth-anything-frames:60s"))
  })

  it("a clip the probe cannot read stays at the ceiling", async () => {
    probe.durations.clear()
    expect(await depthPart([upload, depth()])).toBe(await charged("video-depth-anything:300s"))
  })

  it("a length the upload declares wins without a probe", async () => {
    const declared = { ...upload, data: { ...upload.data, duration: 40 } }
    const total = (await CreditsService.estimateWorkflowCredits([declared, depth()], wires)) - (await CreditsService.estimateWorkflowCredits([declared], []))
    expect(total).toBe(await charged("video-depth-anything:60s"))
  })

  it("probes a URL once, then serves it from the cache", async () => {
    await depthPart([upload, depth()])
    await depthPart([upload, depth()])
    expect(probe.calls).toEqual([CLIP])
  })
})

describe("published-app listing — Video Depth on an uploaded clip", () => {
  it("a fixed upload is probed; one the app user replaces is the ceiling", async () => {
    const fixed = await estimateWorkflowListingCredits([upload, depth()], wires, { publishType: "app", replaceableMediaNodeIds: new Set() })
    const fixedUpload = await estimateWorkflowListingCredits([upload], [], { publishType: "app", replaceableMediaNodeIds: new Set() })
    expect(fixed.preview - fixedUpload.preview).toBe(await charged("video-depth-anything:15s"))
    const replaced = await estimateWorkflowListingCredits([upload, depth()], wires, { publishType: "app", replaceableMediaNodeIds: new Set(["clip"]) })
    const replacedUpload = await estimateWorkflowListingCredits([upload], [], { publishType: "app", replaceableMediaNodeIds: new Set(["clip"]) })
    expect(replaced.preview - replacedUpload.preview).toBe(await charged("video-depth-anything:300s"))
  })
})
