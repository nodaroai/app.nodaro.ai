// @test-units-by-name prices the node types it names (upload-video, video-upscale)
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Video Remake's Precise upscale (2026-11-22) is quoted by the engine through
 * the workflow estimate, on a graph of its own: the take as an upload
 * (`upload-video`: its url, its length, Seedance's 24 fps and its frame) wired
 * into a Topaz Video Upscale (`provider: "topaz"`, the run's target, 24 fps).
 * The child it then starts is held by `planTopazVideoUpscale` over the real
 * file. The two must hold the same units for the same clip, so the quote is
 * what the child holds.
 *
 * The upload's frame is read from `data.metadata.{width,height}` (or a result
 * row of the same url carrying `width`/`height`), never from top-level
 * `width`/`height` (`uploadFrameOf`, @nodaro/render-rules topaz-video-quote.ts):
 * a graph that sends the frame at the top level is quoted at 16:9, which this
 * file pins too, so the engine's field names cannot drift unseen.
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

import { graphPricingUnits } from "../credits.js"
import { planTopazVideoUpscale } from "../../../lib/topaz-video-plan.js"

const URL = "https://cdn.example/take.mp4"
type Node = { id: string; type: string; data: Record<string, unknown> }

/** The engine's estimate graph: the take, then Topaz at the target, both at 24 fps. */
function engineGraph(sec: number, frame: Record<string, unknown>, target: string): { nodes: Node[]; edges: Array<{ source: string; target: string; targetHandle: string }> } {
  return {
    nodes: [
      { id: "take", type: "upload-video", data: { url: URL, duration: sec, fps: 24, ...frame } },
      { id: "x", type: "video-upscale", data: { provider: "topaz", targetResolution: target, targetFps: 24 } },
    ],
    edges: [{ source: "take", target: "x", targetHandle: "video" }],
  }
}
const quotedUnits = (sec: number, frame: Record<string, unknown>, target: string): number => {
  const { nodes, edges } = engineGraph(sec, frame, target)
  return graphPricingUnits(nodes[1]!, nodes, edges, new Set(["x"]))
}
async function heldUnits(width: number, height: number, sec: number, target: string): Promise<number> {
  probe.result = { width, height, durationSeconds: sec, videoDurationSeconds: sec, fps: 24 }
  return (await planTopazVideoUpscale(URL, { targetResolution: target, targetFps: 24 })).holdUnits
}

// Seedance takes at each aspect: 16:9 and 9:16 at 720p, 21:9 at 720p.
const FRAMES = [
  ["16:9", 1280, 720],
  ["21:9", 1680, 720],
  ["9:16", 720, 1280],
] as const
const TARGETS = ["720p", "1080p", "4k"] as const
const LENGTHS = [4, 10, 15, 30] as const

describe("the Precise upscale's quote holds what its child holds", () => {
  beforeEach(() => {
    probe.result = undefined
  })

  for (const [aspect, width, height] of FRAMES) {
    for (const target of TARGETS) {
      it(`${aspect} (${width}x${height}) at Topaz ${target}, 24 fps`, async () => {
        for (const sec of LENGTHS) {
          const quoted = quotedUnits(sec, { metadata: { width, height } }, target)
          expect(quoted, `${sec} s`).toBe(await heldUnits(width, height, sec, target))
        }
      })
    }
  }

  it("a frame sent as a result row of the same url is read too", async () => {
    const quoted = quotedUnits(10, { generatedResults: [{ url: URL, duration: 10, width: 1680, height: 720 }], activeResultIndex: 0 }, "4k")
    expect(quoted).toBe(await heldUnits(1680, 720, 10, "4k"))
  })

  it("a frame sent as top-level width/height is NOT read: quoted at 16:9 (the engine must send metadata.width/height)", async () => {
    const topLevel = quotedUnits(10, { width: 1680, height: 720 }, "4k")
    expect(topLevel).toBe(await heldUnits(1280, 720, 10, "4k"))
    expect(topLevel).not.toBe(await heldUnits(1680, 720, 10, "4k"))
  })
})
