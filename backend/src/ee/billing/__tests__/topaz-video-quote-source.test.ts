// @test-units-by-name prices the node types it names (upload-video, generate-video, trim-video, combine-videos, video-upscale)
import { describe, it, expect, vi } from "vitest"

/**
 * A Topaz Video Upscale is quoted by the run's own rule over what the graph
 * knows of its clip (decided 2026-11-14, `topazVideoQuoteUnits` in
 * @nodaro/render-rules): "Same as source" and an old relative factor read the
 * clip's recorded frame and declared rate; unknown, a 16:9 frame at 30 fps.
 * The editor reads the same rule (the parity fixture holds both halves). This
 * file holds the server's readings the fixture cannot: a source made again in
 * the run, a frame carried through Trim and Combine Videos, and an app listing
 * whose recording the app user replaces.
 */

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

import { estimateWorkflowListingCredits, graphPricingUnits } from "../credits.js"

type Node = { id: string; type: string; data: Record<string, unknown> }
const upload = (id: string, width: number, height: number, sec = 10, extra: Record<string, unknown> = {}): Node => ({
  id,
  type: "upload-video",
  data: { url: `https://cdn.example/${id}.mp4`, generatedResults: [{ url: `https://cdn.example/${id}.mp4`, duration: sec, width, height }], activeResultIndex: 0, ...extra },
})
const upscale = (data: Record<string, unknown> = { targetResolution: "1080p" }): Node => ({ id: "x", type: "video-upscale", data })
const into = (source: string, target = "x", targetHandle = "video") => ({ source, target, targetHandle })
const units = (nodes: Node[], edges: Array<{ source: string; target: string; targetHandle: string }>, rerun: string[] = ["x"]) =>
  graphPricingUnits(nodes.find((n) => n.id === "x")!, nodes, edges, new Set(rerun))

describe("Topaz Video Upscale quote — the clip's frame and rate", () => {
  it("a 10 s 21:9 upload is quoted on its frame (9 units), a 16:9 one on the 7-unit minimum", () => {
    expect(units([upload("u", 2560, 1080), upscale()], [into("u")])).toBe(9)
    expect(units([upload("u", 1920, 1080), upscale()], [into("u")])).toBe(7)
  })

  it("a declared 60 fps on the upload is the rate \"Same as source\" quotes; a set rate wins", () => {
    expect(units([upload("u", 1920, 1080, 10, { fps: 60 }), upscale()], [into("u")])).toBe(13)
    expect(units([upload("u", 1920, 1080, 10, { fps: 60 }), upscale({ targetResolution: "1080p", targetFps: 30 })], [into("u")])).toBe(7)
  })

  it("a generation made again in the run has no frame before it: its earlier take is not read", () => {
    const gen: Node = { id: "g", type: "generate-video", data: { provider: "kling-4", duration: 10, generatedResults: [{ url: "https://cdn.example/g.mp4", duration: 10, width: 2560, height: 1080 }], activeResultIndex: 0 } }
    // A whole run makes the clip again: the 16:9 minimum (its planned 10 s, plus the hold's frame of slack).
    expect(units([gen, upscale()], [into("g")], ["g", "x"])).toBe(7)
    // The upscale run alone hands on the take: its recorded frame.
    expect(units([gen, upscale()], [into("g")], ["x"])).toBe(9)
  })

  it("Trim keeps the frame it is given; Combine Videos keeps it only when every clip shares it", () => {
    const trim: Node = { id: "t", type: "trim-video", data: { startTime: 0, endTime: 5 } }
    expect(units([upload("u", 2560, 1080), trim, upscale()], [into("u", "t"), into("t")], ["t", "x"])).toBe(5)
    const combine: Node = { id: "k", type: "combine-videos", data: {} }
    const twoClips = (b: Node) => units([upload("a", 2560, 1080, 5), b, combine, upscale()], [into("a", "k", "videos"), into(b.id, "k", "videos"), into("k")], ["k", "x"])
    expect(twoClips(upload("b", 2560, 1080, 5))).toBe(9)
    expect(twoClips(upload("b", 1920, 1080, 5))).toBe(7)
  })

  it("a saved node holding only the old 2× factor maps over a known 1080p frame to 4K, as the run does", () => {
    expect(units([upload("u", 1920, 1080), upscale({ upscaleFactor: "2" })], [into("u")])).toBe(25)
    // No known frame: 1080p, as before.
    expect(units([{ id: "u", type: "upload-video", data: { url: "https://cdn.example/u.mp4", duration: 10 } }, upscale({ upscaleFactor: "2" })], [into("u")])).toBe(7)
  })

  it("an app listing reads no frame or rate from a recording the app user replaces", async () => {
    const nodes = [upload("u", 2560, 1080, 10, { fps: 60 }), upscale()]
    const edges = [{ ...into("u"), sourceHandle: "video" }]
    const kept = await estimateWorkflowListingCredits(nodes, edges, { publishType: "app", replaceableMediaNodeIds: new Set() })
    const replaced = await estimateWorkflowListingCredits(nodes, edges, { publishType: "app", replaceableMediaNodeIds: new Set(["u"]) })
    const minimum = await estimateWorkflowListingCredits([upload("u", 1920, 1080), upscale()], edges, { publishType: "app", replaceableMediaNodeIds: new Set(["u"]) })
    // The sample's 21:9 frame at 60 fps lists higher; the user's file is unknown: the 10-second, 16:9, 30 fps minimum.
    expect(kept.preview).toBeGreaterThan(replaced.preview)
    expect(replaced.preview).toBe(minimum.preview)
  })
})
