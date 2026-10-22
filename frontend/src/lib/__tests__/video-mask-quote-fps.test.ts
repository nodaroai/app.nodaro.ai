import { describe, it, expect } from "vitest"
import { videoMaskBilledSeconds, videoMaskCreditId } from "@nodaro/shared/media"
import { videoMaskQuotedSec } from "@/lib/video-utility-estimate"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * The canvas quotes Video Mask at the row the server's workflow estimate
 * quotes (`videoMaskClipSec` in @nodaro/render-rules): an upload that declares
 * its frame rate (`fps`, as a workflow written through the API may carry it)
 * is quoted at its length at the 30 fps basis, as a run is charged; with no
 * declared rate, at its own length, as before.
 */
describe("video-mask canvas quote by frame rate", () => {
  const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
    ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
  const wire = (source: string, target: string, targetHandle?: string): WorkflowEdge =>
    ({ id: `${source}-${target}`, source, target, targetHandle }) as unknown as WorkflowEdge
  const upload = (extra: Record<string, unknown> = {}) =>
    node("u", "upload-video", { url: "https://cdn.example.com/clip.mp4", duration: 10, ...extra })
  const mask = node("m", "video-mask", { provider: "sam-3.1" })
  const billedRow = videoMaskCreditId(Math.ceil(videoMaskBilledSeconds(10, 60)), "sam-3.1")

  it("a 10-second upload at 60 fps is quoted at the row a 20-second clip is charged", () => {
    expect(billedRow).not.toBe(videoMaskCreditId(10, "sam-3.1"))
    const nodes = [upload({ fps: 60 }), mask]
    const edges = [wire("u", "m", "video")]
    expect(videoMaskQuotedSec(mask, nodes, edges)).toBe(20)
    expect(getModelIdentifier(mask, edges, nodes)).toBe(billedRow)
  })

  it("through a teleport pair, the same row", () => {
    const nodes = [upload({ fps: 60 }), node("s", "teleport-send"), node("r", "teleport-receive"), mask]
    const edges = [wire("u", "s"), wire("s", "r"), wire("r", "m", "video")]
    expect(getModelIdentifier(mask, edges, nodes)).toBe(billedRow)
  })

  it("through a Trim and a Loop, the upload's rate is carried (the server's runWireFps)", () => {
    const nodes = [
      upload({ fps: 60, duration: 5 }),
      node("l", "loop-video", { mode: "repeat", repeatCount: 2 }),
      node("t", "trim-video", { trimMode: "keep-first-seconds", keepFirstSeconds: 10 }),
      mask,
    ]
    const edges = [wire("u", "l"), wire("l", "t"), wire("t", "m", "video")]
    expect(videoMaskQuotedSec(mask, nodes, edges)).toBe(20)
    expect(getModelIdentifier(mask, edges, nodes)).toBe(billedRow)
  })

  it("through a Combine, only when its clips share one rate", () => {
    const clip = (id: string, fps?: number) =>
      node(id, "upload-video", { url: `https://cdn.example.com/${id}.mp4`, duration: 5, ...(fps === undefined ? {} : { fps }) })
    const combine = node("c", "combine-videos")
    const edges = [wire("a", "c"), wire("b", "c"), wire("c", "m", "video")]
    expect(videoMaskQuotedSec(mask, [clip("a", 60), clip("b", 60), combine, mask], edges)).toBe(20)
    expect(videoMaskQuotedSec(mask, [clip("a", 60), clip("b", 24), combine, mask], edges)).toBe(10)
    expect(videoMaskQuotedSec(mask, [clip("a", 60), clip("b"), combine, mask], edges)).toBe(10)
  })

  it.each([
    ["absent", {}],
    ["24", { fps: 24 }],
    ["30", { fps: 30 }],
    ["0", { fps: 0 }],
    ["a string", { fps: "60" }],
  ])("fps %s: quoted at the clip's own length, as before", (_label, extra) => {
    const nodes = [upload(extra), mask]
    const edges = [wire("u", "m", "video")]
    expect(videoMaskQuotedSec(mask, nodes, edges)).toBe(10)
    expect(getModelIdentifier(mask, edges, nodes)).toBe(videoMaskCreditId(10, "sam-3.1"))
  })
})
