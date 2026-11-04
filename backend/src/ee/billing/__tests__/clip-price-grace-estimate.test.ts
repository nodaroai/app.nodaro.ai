// @test-units-by-name prices the node types it names (upload-video, video-depth, video-mask, mask-composite, video-face-mesh)
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * THE QUOTE AND THE CHARGE OF A LENGTH-PRICED STEP ARE ONE FIGURE.
 *
 * The Nodaro Motion quote asks the workflow estimate for Video Mask, Video
 * Depth, Mask Composite and the face mesh on an `upload-video` that declares
 * the clip's length; each child run is then charged from the file its route
 * measures. A whole-second cut of a 29.97 or 23.976 fps clip can come out a
 * little long, so the two read 12 and 12.012. Up to 0.05 s past a whole second
 * is ignored on both sides.
 */

const { mockProbe } = vi.hoisted(() => ({ mockProbe: vi.fn() }))
vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/ffmpeg-utils.js")>()),
  probeVideoSource: mockProbe,
}))

import { CreditsService, STATIC_CREDIT_COSTS } from "../credits.js"
import { measureMaskCompositeLength } from "../../../lib/mask-composite-length.js"
import { measureVideoDepthInput } from "../../../lib/video-depth-input.js"
import { measureVideoFaceMeshLength } from "../../../lib/video-face-mesh-length.js"
import { measureVideoMaskLength } from "../../../lib/video-mask-length.js"

type N = { id: string; type: string; data: Record<string, unknown> }
type E = { source: string; target: string; targetHandle: string }

const URL = "https://cdn.example/clip.mp4"
const upload = (duration: number, fps?: number): N => ({
  id: "clip",
  type: "upload-video",
  data: { url: URL, duration, ...(fps === undefined ? {} : { fps }) },
})
const part = (clip: N, step: N, handle: string): number =>
  CreditsService.estimateWorkflowBaseCredits([clip, step], [{ source: "clip", target: step.id, targetHandle: handle } satisfies E]) -
  CreditsService.estimateWorkflowBaseCredits([clip], [])

const depthQuote = (clip: N) => part(clip, { id: "depth", type: "video-depth", data: { colormap: "turbo" } }, "video")
const framesQuote = (clip: N) => part(clip, { id: "depth", type: "video-depth", data: { provider: "depth-anything-frames" } }, "video")
const maskQuote = (clip: N) => part(clip, { id: "mask", type: "video-mask", data: {} }, "video")
const meshQuote = (clip: N) => part(clip, { id: "mesh", type: "video-face-mesh", data: {} }, "video")
const compositeQuote = (clip: N) => part(clip, { id: "fill", type: "mask-composite", data: { fill: "blur" } }, "background-video")

const probed = (durationSeconds: number, fps?: number) =>
  mockProbe.mockResolvedValue({ width: 640, height: 360, durationSeconds, ...(fps === undefined ? {} : { fps }) })

beforeEach(() => {
  mockProbe.mockReset()
})

// Base credits. Each cut's quoted figure is its whole-second clip's.
const CUTS = [
  { cut: 4, file: 4.004, mask: 50, composite: 10, mesh: 5, depth: 80 },
  { cut: 5, file: 5.005, mask: 50, composite: 10, mesh: 5, depth: 100 },
  { cut: 10, file: 10.01, mask: 95, composite: 20, mesh: 10, depth: 200 },
  { cut: 12, file: 12.012, mask: 145, composite: 30, mesh: 15, depth: 240 },
  { cut: 15, file: 15.015, mask: 145, composite: 30, mesh: 15, depth: 300 },
]

describe.each(CUTS)("a $cut s cut at 29.97 fps, a $file s file", ({ cut, file, mask, composite, mesh, depth }) => {
  it("the workflow estimate gives the same figure for the cut and for the file", () => {
    for (const sec of [cut, file]) {
      expect(maskQuote(upload(sec)), `mask at ${sec}`).toBe(mask)
      expect(compositeQuote(upload(sec)), `composite at ${sec}`).toBe(composite)
      expect(meshQuote(upload(sec)), `mesh at ${sec}`).toBe(mesh)
      expect(depthQuote(upload(sec)), `depth at ${sec}`).toBe(depth)
    }
  })

  it("each step's route reserves that figure for the file", async () => {
    probed(file, 29.97)
    const m = await measureVideoMaskLength(URL)
    const f = await measureVideoFaceMeshLength(URL)
    const d = await measureVideoDepthInput("video-depth-anything", URL)
    const c = await measureMaskCompositeLength(URL)
    if (!m.ok || !f.ok || !d.ok || !c.ok) throw new Error("a step refused the clip")
    expect(STATIC_CREDIT_COSTS[m.creditId]).toBe(mask)
    expect(STATIC_CREDIT_COSTS[f.creditId]).toBe(mesh)
    expect(STATIC_CREDIT_COSTS[d.creditId]).toBe(depth)
    expect(c.units * STATIC_CREDIT_COSTS["mask-composite"]!).toBe(composite)
  })
})

describe("the estimate and the route agree at every length", () => {
  const seconds = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 14, 15, 16, 29, 30, 31, 59, 60, 61, 79, 120, 180, 299, 300]
  const offsets = [-0.02, 0, 0.004, 0.012, 0.03, 0.05, 0.051, 0.5]
  const lengths = seconds.flatMap((n) => offsets.map((o) => n + o)).filter((sec) => sec > 0 && sec <= 300)

  it.each([[undefined], [23.976], [29.97], [30], [59.94], [60]])("at %s fps", async (fps) => {
    for (const sec of lengths) {
      const clip = upload(sec, fps)
      probed(sec, fps)
      const m = await measureVideoMaskLength(URL)
      if (m.ok) expect(maskQuote(clip), `mask at ${sec}`).toBe(STATIC_CREDIT_COSTS[m.creditId])
      const f = await measureVideoFaceMeshLength(URL)
      if (f.ok) expect(meshQuote(clip), `mesh at ${sec}`).toBe(STATIC_CREDIT_COSTS[f.creditId])
      const d = await measureVideoDepthInput("video-depth-anything", URL)
      if (d.ok) expect(depthQuote(clip), `depth at ${sec}`).toBe(STATIC_CREDIT_COSTS[d.creditId])
      const pf = await measureVideoDepthInput("depth-anything-frames", URL)
      if (pf.ok) expect(framesQuote(clip), `per frame at ${sec}`).toBe(STATIC_CREDIT_COSTS[pf.creditId])
      const c = await measureMaskCompositeLength(URL)
      if (c.ok) expect(compositeQuote(clip), `composite at ${sec}`).toBe(c.units * STATIC_CREDIT_COSTS["mask-composite"]!)
    }
  })
})

describe("Depth Anything per frame", () => {
  // Base credits. A cut's quote and the file's charge are one figure.
  it.each([
    { cut: 15, file: 15.015, base: 30 },
    { cut: 30, file: 30.03, base: 60 },
    { cut: 60, file: 60.0266, base: 120 },
  ])("a $cut s cut, a $file s file: $base base credits, quoted and charged", async ({ cut, file, base }) => {
    expect(framesQuote(upload(cut))).toBe(base)
    expect(framesQuote(upload(file))).toBe(base)
    probed(file, 29.97)
    const measured = await measureVideoDepthInput("depth-anything-frames", URL)
    if (!measured.ok) throw new Error("the provider refused the clip")
    expect(STATIC_CREDIT_COSTS[measured.creditId]).toBe(base)
  })

  it("past the grace is the next price step, in the estimate too", () => {
    expect(framesQuote(upload(15.051))).toBe(STATIC_CREDIT_COSTS["depth-anything-frames:30s"])
    expect(framesQuote(upload(60.06))).toBe(STATIC_CREDIT_COSTS["depth-anything-frames:120s"])
  })
})
