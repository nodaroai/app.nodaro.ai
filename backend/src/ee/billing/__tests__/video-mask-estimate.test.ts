// @test-units-by-name prices the node types it names (upload-video, video-mask, video-depth, mask-composite, trim-video, loop-video, combine-videos, teleport-send, teleport-receive)
import { describe, it, expect } from "vitest"
import { videoMaskBilledSeconds, videoMaskCreditId } from "@nodaro/shared/media"
import { STATIC_CREDIT_COSTS, CreditsService } from "../credits.js"

// The pre-run estimate quotes Video Mask the way a run is charged: the row for
// the clip's PRICED length (`videoMaskBilledSeconds` — its duration at the
// 30 fps basis). An upload whose data declares its frame rate (`fps`, as a
// workflow written through the API may carry, beside `duration`) is priced at
// that rate; a clip with no declared rate at its own length, as before. Video
// Depth and Mask Composite are priced by seconds only, whatever the rate.

type N = { id?: string; type: string; data?: Record<string, unknown> }
type E = { source: string; target: string; targetHandle?: string }

const est = (nodes: N[], edges?: E[]) => CreditsService.estimateWorkflowBaseCredits(nodes, edges)

const upload = (extra: Record<string, unknown> = {}): N => ({
  id: "rec",
  type: "upload-video",
  data: { url: "https://cdn.example.com/clip.mp4", duration: 10, ...extra },
})

/** The estimate of `step` on the upload's wire, the upload's own price taken out. */
const stepPart = (rec: N, step: N, handle = "video") =>
  est([rec, step], [{ source: "rec", target: step.id!, targetHandle: handle }]) - est([rec])

const mask: N = { id: "vm", type: "video-mask", data: {} }
const rowCost = (sec: number, fps?: number) => STATIC_CREDIT_COSTS[videoMaskCreditId(Math.ceil(videoMaskBilledSeconds(sec, fps)))]

describe("video-mask workflow estimate by frame rate", () => {
  it("a 10-second upload at 60 fps is quoted at the row billing charges (a 20-second clip)", () => {
    const expected = rowCost(10, 60)
    expect(expected).toBeDefined()
    // The test only proves something while the two rows differ.
    expect(expected).not.toBe(rowCost(10))
    expect(stepPart(upload({ fps: 60 }), mask)).toBe(expected)
  })

  it("follows a teleport between the upload and the mask", () => {
    const nodes: N[] = [
      upload({ fps: 60 }),
      { id: "tp-send", type: "teleport-send", data: {} },
      { id: "tp-recv", type: "teleport-receive", data: {} },
      mask,
    ]
    const edges: E[] = [
      { source: "rec", target: "tp-send" },
      { source: "tp-send", target: "tp-recv" },
      { source: "tp-recv", target: "vm", targetHandle: "video" },
    ]
    const without = est(nodes.slice(0, 3), edges.slice(0, 2))
    expect(est(nodes, edges) - without).toBe(rowCost(10, 60))
  })

  it.each([
    ["absent", {}],
    ["24", { fps: 24 }],
    ["30", { fps: 30 }],
    ["0", { fps: 0 }],
    ["negative", { fps: -1 }],
    ["a string", { fps: "60" }],
  ])("fps %s: priced at the clip's own length, as before", (_label, extra) => {
    expect(stepPart(upload(extra), mask)).toBe(rowCost(10))
  })

  it("an upload with no file (no url) stays at the ceiling row, fps or not", () => {
    const rec: N = { id: "rec", type: "upload-video", data: { duration: 10, fps: 60 } }
    expect(stepPart(rec, mask)).toBe(STATIC_CREDIT_COSTS[videoMaskCreditId(undefined)])
  })

  it("on the SAM 3 provider, that provider's row for the priced length", () => {
    const sam3: N = { id: "vm", type: "video-mask", data: { provider: "sam-3" } }
    expect(stepPart(upload({ fps: 60 }), sam3)).toBe(
      STATIC_CREDIT_COSTS[videoMaskCreditId(Math.ceil(videoMaskBilledSeconds(10, 60)), "sam-3")],
    )
  })

  // Trim and Loop keep their input's frame rate, and Combine Videos conforms
  // its clips to their shared rate: the rate is carried through them the same
  // way the length is (`runWireFps`), so the mask after them is quoted at the
  // row its run is charged.
  describe("through the steps that keep the frame rate", () => {
    const clip = (id: string, sec: number, fps?: number): N => ({
      id,
      type: "upload-video",
      data: { url: `https://cdn.example.com/${id}.mp4`, duration: sec, ...(fps === undefined ? {} : { fps }) },
    })
    /** The mask's part of the estimate: the whole graph minus the graph without it. */
    const maskPart = (nodes: N[], edges: E[]) =>
      est([...nodes, mask], [...edges, { source: edges.at(-1)?.target ?? nodes[0]!.id!, target: "vm", targetHandle: "video" }]) - est(nodes, edges)

    it("a Trim of a 60 fps upload (first 10 s) is quoted at its rate", () => {
      const trim: N = { id: "t", type: "trim-video", data: { trimMode: "keep-first-seconds", keepFirstSeconds: 10 } }
      expect(maskPart([clip("rec", 30, 60), trim], [{ source: "rec", target: "t" }])).toBe(rowCost(10, 60))
    })

    it("a Loop (repeat ×2) of a 5-second 60 fps upload is quoted at its rate", () => {
      const loop: N = { id: "l", type: "loop-video", data: { mode: "repeat", repeatCount: 2 } }
      expect(maskPart([clip("rec", 5, 60), loop], [{ source: "rec", target: "l" }])).toBe(rowCost(10, 60))
    })

    it("a Trim after a Loop after a teleport still carries the rate", () => {
      const nodes: N[] = [
        clip("rec", 5, 60),
        { id: "tp-send", type: "teleport-send", data: {} },
        { id: "tp-recv", type: "teleport-receive", data: {} },
        { id: "l", type: "loop-video", data: { mode: "repeat", repeatCount: 2 } },
        { id: "t", type: "trim-video", data: { trimMode: "keep-first-seconds", keepFirstSeconds: 10 } },
      ]
      const edges: E[] = [
        { source: "rec", target: "tp-send" },
        { source: "tp-send", target: "tp-recv" },
        { source: "tp-recv", target: "l" },
        { source: "l", target: "t" },
      ]
      expect(maskPart(nodes, edges)).toBe(rowCost(10, 60))
    })

    it("a Combine of clips that share one rate is quoted at that rate", () => {
      const combine: N = { id: "c", type: "combine-videos", data: {} }
      const nodes = [clip("a", 5, 60), clip("b", 5, 60), combine]
      expect(maskPart(nodes, [{ source: "a", target: "c" }, { source: "b", target: "c" }])).toBe(rowCost(10, 60))
    })

    it.each([
      ["mixed rates", 60, 24],
      ["one rate unknown", 60, undefined],
    ])("a Combine of clips with %s: the rate is unknown, priced at its own length", (_label, fpsA, fpsB) => {
      const combine: N = { id: "c", type: "combine-videos", data: {} }
      const nodes = [clip("a", 5, fpsA), clip("b", 5, fpsB), combine]
      expect(maskPart(nodes, [{ source: "a", target: "c" }, { source: "b", target: "c" }])).toBe(rowCost(10))
    })

    it("a Combine of clips that share a rate above 60 fps is quoted at 60 (the run conforms them to at most 60)", () => {
      const combine: N = { id: "c", type: "combine-videos", data: {} }
      const nodes = [clip("a", 5, 120), clip("b", 5, 120), combine]
      expect(rowCost(10, 60)).not.toBe(rowCost(10, 120))
      expect(maskPart(nodes, [{ source: "a", target: "c" }, { source: "b", target: "c" }])).toBe(rowCost(10, 60))
    })

    it("a cycle of Trims stops at unknown: priced at its own length, never a loop", () => {
      const t1: N = { id: "t1", type: "trim-video", data: { trimMode: "time", startTime: 0, endTime: 10 } }
      const t2: N = { id: "t2", type: "trim-video", data: { trimMode: "time", startTime: 0, endTime: 10 } }
      expect(maskPart([t1, t2], [{ source: "t2", target: "t1" }, { source: "t1", target: "t2" }])).toBe(rowCost(10))
    })

    it("a Trim of an upload with no declared rate: its own length, as before", () => {
      const trim: N = { id: "t", type: "trim-video", data: { trimMode: "keep-first-seconds", keepFirstSeconds: 10 } }
      expect(maskPart([clip("rec", 30), trim], [{ source: "rec", target: "t" }])).toBe(rowCost(10))
    })
  })

  it("Video Depth is priced by seconds only: unchanged with fps present", () => {
    const depth: N = { id: "vd", type: "video-depth", data: {} }
    expect(stepPart(upload({ fps: 60 }), depth)).toBe(stepPart(upload(), depth))
  })

  it("Mask Composite is priced by seconds only: unchanged with fps present", () => {
    const composite: N = { id: "mc", type: "mask-composite", data: {} }
    expect(stepPart(upload({ fps: 60 }), composite)).toBe(stepPart(upload(), composite))
  })
})
