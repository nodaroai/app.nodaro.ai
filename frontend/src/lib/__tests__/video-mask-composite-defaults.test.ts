import { describe, it, expect } from "vitest"
import {
  DEFAULT_VIDEO_MASK_PROVIDER,
  MASK_COMPOSITE_DEFAULTS,
  VIDEO_MASK_LIMITS,
  resolveMaskCompositeSettings,
  videoMaskCreditId,
} from "@nodaro/shared/media"
import { NODE_DEF_MAP } from "@/types/nodes"
import { maskCompositePricingUnits } from "@/lib/video-utility-estimate"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * The Video Mask defaults in NODE_DEFINITIONS are literals (gen-skills reads
 * types/nodes.ts as text and cannot follow a property access), so this pins
 * them to the shared contract the route's Zod schema defaults to. Mask
 * Composite spreads MASK_COMPOSITE_DEFAULTS directly; pinned here too so a
 * hand-typed override cannot creep in.
 */
describe("video-mask / mask-composite node defaults follow the shared contract", () => {
  it("video-mask threshold + provider equal VIDEO_MASK_LIMITS / DEFAULT_VIDEO_MASK_PROVIDER", () => {
    const d = NODE_DEF_MAP.get("video-mask")!.defaultData as Record<string, unknown>
    expect(d.threshold).toBe(VIDEO_MASK_LIMITS.THRESHOLD_DEFAULT)
    expect(d.provider).toBe(DEFAULT_VIDEO_MASK_PROVIDER)
  })

  it("mask-composite defaults are exactly MASK_COMPOSITE_DEFAULTS (and survive the normaliser)", () => {
    const d = NODE_DEF_MAP.get("mask-composite")!.defaultData as Record<string, unknown>
    expect(resolveMaskCompositeSettings(d)).toEqual({ ...MASK_COMPOSITE_DEFAULTS })
    for (const [k, v] of Object.entries(MASK_COMPOSITE_DEFAULTS)) expect(d[k]).toEqual(v)
  })
})

describe("video-mask credit id (editor quote)", () => {
  const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
    ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
  const wire = (source: string, target: string, targetHandle: string): WorkflowEdge =>
    ({ id: `${source}-${target}`, source, target, targetHandle }) as unknown as WorkflowEdge

  it("an unknown clip length quotes the longest row (never the bare provider id)", () => {
    const mask = node("m", "video-mask", { provider: "sam-3" })
    expect(getModelIdentifier(mask, [], [mask])).toBe(videoMaskCreditId(undefined, "sam-3"))
    const def = node("d", "video-mask", {})
    expect(getModelIdentifier(def, [], [def])).toBe("sam-3.1-video:300s")
  })

  it("a connected upload of known length quotes that length's row", () => {
    const up = node("u", "upload-video", { videoUrl: "https://x/v.mp4", duration: 12 })
    const mask = node("m", "video-mask", { provider: "sam-3" })
    const id = getModelIdentifier(mask, [wire("u", "m", "video")], [up, mask])
    expect(id).toBe(videoMaskCreditId(12, "sam-3"))
  })

  it("mask-composite prices its one-unit row × one unit per started 5 s of the foreground (unknown → the 300 s cap)", () => {
    const mc = node("c", "mask-composite")
    expect(getModelIdentifier(mc, [], [mc])).toBe("mask-composite")
    expect(maskCompositePricingUnits(mc, [mc], [])).toBe(60)
    const up = node("u", "upload-video", { videoUrl: "https://x/v.mp4", duration: 12 })
    expect(maskCompositePricingUnits(mc, [up, mc], [wire("u", "c", "video")])).toBe(3)
  })

  it("mask-composite with a pixelate / blur fill prices on the background (its `background-video` wire), never the ignored foreground", () => {
    const fg = node("f", "upload-video", { videoUrl: "https://x/f.mp4", duration: 12 })
    const bg = node("b", "upload-video", { videoUrl: "https://x/b.mp4", duration: 41 })
    const edges = [wire("f", "c", "video"), wire("b", "c", "background-video")]
    expect(maskCompositePricingUnits(node("c", "mask-composite"), [fg, bg], edges)).toBe(3)
    for (const fill of ["pixelate", "blur"]) {
      const mc = node("c", "mask-composite", { fill })
      expect(maskCompositePricingUnits(mc, [fg, bg, mc], edges)).toBe(9)
      // No background wired yet: the 300 s cap, even with a foreground of known length.
      expect(maskCompositePricingUnits(mc, [fg, mc], [wire("f", "c", "video")])).toBe(60)
    }
  })
})
