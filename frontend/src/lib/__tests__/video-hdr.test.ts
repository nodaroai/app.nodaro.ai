import { describe, it, expect } from "vitest"
import { generateVideoProviderSnap, hdrResolutionOptions, videoHdrSnap } from "@/lib/generate-video-provider-snap"
import { hdrAddonCreditIdOf, hdrResolutionText } from "@/lib/video-hdr"
import { getVideoResolutionOptions } from "@/components/editor/config-panels/model-options"
import { NODE_QUICK_CONFIGS } from "@/components/nodes/node-quick-configs"
import { videoHdrResolutionProblem } from "@nodaro/shared/models"
import { parseSeedanceRefQuoteKey, seedanceRefQuoteKeyFor } from "@/lib/seedance-ref-quote"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * Kling 4.0 HDR in the editor (decided 2026-11-22): turning HDR on at 720p
 * moves the size to 1080p in view, a size HDR does not render is never
 * offered, and the node's price carries the add-on's own row.
 */
describe("the HDR snap (config panel switch, run strip, provider change)", () => {
  it("HDR on at 720p, or with no size (720p), moves the size to 1080p", () => {
    expect(videoHdrSnap({ provider: "kling-4", resolution: "720p", dynamicRange: "hdr" }, "kling-4")).toEqual({ resolution: "1080p" })
    expect(videoHdrSnap({ provider: "kling-4-keyframes", dynamicRange: "hdr" }, "kling-4-keyframes")).toEqual({ resolution: "1080p" })
  })

  it("HDR at 1080p or 4K, and SDR at any size, stay as they are", () => {
    expect(videoHdrSnap({ resolution: "4k", dynamicRange: "hdr" }, "kling-4")).toEqual({})
    expect(videoHdrSnap({ resolution: "720p", dynamicRange: "sdr" }, "kling-4")).toEqual({})
    expect(videoHdrSnap({ resolution: "720p" }, "kling-4")).toEqual({})
  })

  it("a model without HDR clears the setting (the provider-change fail-safe)", () => {
    expect(videoHdrSnap({ resolution: "720p", dynamicRange: "hdr" }, "kling-4-flash")).toEqual({ dynamicRange: undefined })
    expect(generateVideoProviderSnap({ provider: "kling-4-flash", resolution: "1080p", dynamicRange: "hdr" }, "kling-4-flash")).toMatchObject({ dynamicRange: undefined })
    // Switching onto Kling 4.0 with HDR stored and no size: the persisted 720p moves up to 1080p.
    expect(generateVideoProviderSnap({ provider: "kling-4", dynamicRange: "hdr" }, "kling-4")).toMatchObject({ resolution: "1080p" })
  })

  it("with HDR on only the sizes HDR renders at are offered", () => {
    const all = getVideoResolutionOptions("kling-4")
    expect(all?.map((o) => o.value)).toEqual(["720p", "1080p", "4k"])
    expect(hdrResolutionOptions("kling-4", "hdr", all)?.map((o) => o.value)).toEqual(["1080p", "4k"])
    expect(hdrResolutionOptions("kling-4", "sdr", all)).toBe(all)
  })

  it("the run strip offers SDR / HDR on Kling 4.0 only, and its HDR choice moves 720p to 1080p", () => {
    const control = NODE_QUICK_CONFIGS()["generate-video"]!.find((c) => c.field === "dynamicRange")!
    const options = control.options as (d: Record<string, unknown>) => ReadonlyArray<{ value: string }>
    expect(options({ provider: "kling-4" }).map((o) => o.value)).toEqual(["sdr", "hdr"])
    expect(options({ provider: "kling-4-flash" })).toEqual([])
    expect(control.write!("hdr", { provider: "kling-4", resolution: "720p" })).toEqual({ dynamicRange: "hdr", resolution: "1080p" })
    expect(control.write!("sdr", { provider: "kling-4", resolution: "1080p", dynamicRange: "hdr" })).toEqual({ dynamicRange: undefined })
    const resolution = NODE_QUICK_CONFIGS()["generate-video"]!.find((c) => c.field === "resolution")!
    const sizes = resolution.options as (d: Record<string, unknown>) => ReadonlyArray<{ value: string }>
    expect(sizes({ provider: "kling-4", dynamicRange: "hdr" }).map((o) => o.value)).toEqual(["1080p", "4k"])
    expect(sizes({ provider: "kling-4" }).map((o) => o.value)).toEqual(["720p", "1080p", "4k"])
  })
})

describe("the node's HDR add-on id", () => {
  it("names the add-on row on an HDR Generate Video node, at its size and length", () => {
    expect(hdrAddonCreditIdOf({ type: "generate-video", data: { provider: "kling-4", resolution: "4k", duration: 10, dynamicRange: "hdr" } })).toBe("kling-4-hdr:10s:4k")
    expect(hdrAddonCreditIdOf({ type: "generate-video", data: { provider: "kling-4-keyframes", resolution: "1080p", dynamicRange: "hdr" } })).toBe("kling-4-hdr:5s:1080p")
  })

  it("none on an SDR node, at 720p, on Flash, or on any other node type", () => {
    expect(hdrAddonCreditIdOf({ type: "generate-video", data: { provider: "kling-4", resolution: "1080p" } })).toBeUndefined()
    expect(hdrAddonCreditIdOf({ type: "generate-video", data: { provider: "kling-4", dynamicRange: "hdr" } })).toBeUndefined()
    expect(hdrAddonCreditIdOf({ type: "generate-video", data: { provider: "kling-4-flash", dynamicRange: "hdr" } })).toBeUndefined()
    expect(hdrAddonCreditIdOf({ type: "generate-video-pro", data: { provider: "kling-4", resolution: "4k", dynamicRange: "hdr" } })).toBeUndefined()
  })

  it("the Run's refusal names the sizes HDR takes", () => {
    const problem = videoHdrResolutionProblem("kling-4", { resolution: "720p", dynamicRange: "hdr", nothingCharged: true })!
    expect(hdrResolutionText("kling-4", problem)).toContain("1080p / 4k")
  })
})

describe("the reference-video quote of an HDR node", () => {
  const CLIP = "https://cdn.example/clip.mp4"
  const clip = { id: "clip", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "clip", url: CLIP } } as unknown as WorkflowNode
  const gv = (data: Record<string, unknown>) =>
    ({ id: "gv", type: "generate-video", position: { x: 0, y: 0 }, data: { label: "gv", provider: "kling-4", duration: 5, resolution: "1080p", ...data } }) as unknown as WorkflowNode
  const edges = [{ id: "e", source: "clip", target: "gv", sourceHandle: "video", targetHandle: "videoReferences" }] as WorkflowEdge[]

  it("keys the HDR setting, so turning it on re-quotes, and the parsed request the server is asked carries it", () => {
    const sdr = seedanceRefQuoteKeyFor(gv({}), [clip, gv({})], edges)!
    const hdrNode = gv({ dynamicRange: "hdr" })
    const hdr = seedanceRefQuoteKeyFor(hdrNode, [clip, hdrNode], edges)!
    expect(hdr).not.toBe(sdr)
    expect(parseSeedanceRefQuoteKey(hdr)?.dynamicRange).toBe("hdr")
    expect(parseSeedanceRefQuoteKey(sdr)).not.toHaveProperty("dynamicRange")
  })
})
