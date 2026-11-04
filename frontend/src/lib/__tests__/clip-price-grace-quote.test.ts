import { describe, expect, it } from "vitest"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { maskCompositePricingUnits, videoMaskQuotedSec } from "@/lib/video-utility-estimate"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * The canvas quotes a clip as the server charges it: a whole-second cut of a
 * 29.97 or 23.976 fps clip can come out a little long, and Video Depth, Video
 * Mask and Mask Composite ignore up to 0.05 s past a whole second before they
 * price it.
 */
describe("the canvas quote of a clip just past a whole second", () => {
  const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
    ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
  const wire = (target: string, targetHandle: string): WorkflowEdge =>
    ({ id: `u-${target}`, source: "u", target, targetHandle }) as unknown as WorkflowEdge
  const upload = (duration: number, extra: Record<string, unknown> = {}) =>
    node("u", "upload-video", { url: "https://cdn.example.com/clip.mp4", duration, ...extra })

  const depth = node("d", "video-depth", { provider: "video-depth-anything" })
  const mask = node("m", "video-mask", { provider: "sam-3.1" })
  const composite = node("c", "mask-composite", { fill: "video" })

  it.each([
    [4.004, 4],
    [5.005, 5],
    [10.01, 10],
    [12.012, 12],
    [15.015, 15],
    [4.051, 5],
    [12, 12],
  ])("Video Depth Anything: %s s is the %i s row", (sec, row) => {
    expect(getModelIdentifier(depth, [wire("d", "video")], [upload(sec), depth])).toBe(`video-depth-anything:${row}s`)
  })

  it.each([
    [15, 15],
    [15.015, 15],
    [15.051, 16],
    [30.03, 30],
    [60.0266, 60],
    [60.06, 61],
  ])("Depth Anything per frame: %s s is the %i s row", (sec, step) => {
    const frames = node("d", "video-depth", { provider: "depth-anything-frames" })
    expect(getModelIdentifier(frames, [wire("d", "video")], [upload(sec), frames])).toBe(`depth-anything-frames:${step}s`)
  })

  it.each([
    [4.004, 4, 5],
    [5.005, 5, 5],
    [10.01, 10, 10],
    [12.012, 12, 15],
    [15.015, 15, 15],
    [5.051, 6, 10],
  ])("Video Mask: %s s is quoted at %i s, the %i s row", (sec, quoted, row) => {
    const nodes = [upload(sec), mask]
    const edges = [wire("m", "video")]
    expect(videoMaskQuotedSec(mask, nodes, edges)).toBe(quoted)
    expect(getModelIdentifier(mask, edges, nodes)).toBe(`sam-3.1-video:${row}s`)
  })

  it("Video Mask at 60 fps: the grace is on the priced length", () => {
    const edges = [wire("m", "video")]
    expect(videoMaskQuotedSec(mask, [upload(5.02, { fps: 60 }), mask], edges)).toBe(10)
    expect(videoMaskQuotedSec(mask, [upload(5.03, { fps: 60 }), mask], edges)).toBe(11)
  })

  it.each([
    [4.004, 1],
    [5.005, 1],
    [10.01, 2],
    [12.012, 3],
    [15.015, 3],
    [5.051, 2],
  ])("Mask Composite: %s s is %i unit(s)", (sec, units) => {
    expect(maskCompositePricingUnits(composite, [upload(sec), composite], [wire("c", "video")])).toBe(units)
  })
})
