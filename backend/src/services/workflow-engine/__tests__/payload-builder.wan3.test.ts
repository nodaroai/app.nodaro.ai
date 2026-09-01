/**
 * Wan 3.0 / Wan 3.0 Prime UI-default fills in the payload builder.
 *
 * The Wan config panel RENDERS `adaptive` + 720p defaults without persisting
 * them to node data, so an untouched node submits aspectRatio / resolution
 * undefined. The builder fills them so the enqueued job row (and the
 * /v1/jobs echo) states what actually renders.
 *
 * The load-bearing assertion is the RESOLUTION: Wan's catalog `resolutions`
 * are ascending (`["480p","720p","1080p"]`), so an `opts[0]` / `resolutions[0]`
 * fill would write 480p — while `runWan3` renders 720P and the credit
 * identifier bills the 720p tier. The fill must therefore come from
 * PRICING_DEFAULT_RESOLUTION, the same declaration billing reads.
 */
import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, PRICING_DEFAULT_RESOLUTION, buildVideoCreditModelIdentifier } from "@nodaro/shared"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, ResolvedInputs } from "../types.js"

const JOB_ID = "job-wan3-1"
const WAN = ["wan-3", "wan-3-prime"] as const

function n(type: string, provider: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id: "wan-1", type, data: { provider, prompt: "a slow dolly across a rainy street", ...data } }
}

function build(node: SimpleNode, inputs: ResolvedInputs = {}) {
  return buildPayload(node, JOB_ID, inputs, undefined, { nodes: [node], edges: [], nodeStates: {} })
}

describe("Wan 3.0 payload-builder defaults", () => {
  it("the catalog list is ascending, so index 0 is NOT the billed default", () => {
    // Guards the reason this fill exists at all: if someone ever reorders the
    // catalog to smuggle the default in via position, this fails loudly rather
    // than the fill silently agreeing with a wrong number.
    for (const p of WAN) {
      expect(MODEL_CATALOG[p]?.resolutions?.[0], p).toBe("480p")
      expect(PRICING_DEFAULT_RESOLUTION[p], p).toBe("720p")
    }
  })

  for (const p of WAN) {
    it(`${p}: generate-video fills adaptive + the DECLARED 720p default`, () => {
      const r = build(n("generate-video", p))
      expect(r.payload.aspectRatio).toBe("adaptive")
      expect(r.payload.resolution).toBe("720p")
    })

    it(`${p}: the filled resolution is the tier the reservation bills`, () => {
      const r = build(n("generate-video", p))
      // Same composite whether the request states 720p or omits it entirely —
      // render == billed for an intent-less run.
      expect(r.modelIdentifier).toBe(
        buildVideoCreditModelIdentifier(p, undefined, undefined, "text-to-video", undefined, undefined, undefined),
      )
      expect(r.modelIdentifier).toContain(":720p")
    })

    it(`${p}: an explicit node value always wins over the fill`, () => {
      const r = build(n("generate-video", p, { aspectRatio: "9:16", resolution: "1080p", duration: 8 }))
      expect(r.payload.aspectRatio).toBe("9:16")
      expect(r.payload.resolution).toBe("1080p")
    })

    it(`${p}: the legacy standalone t2v / i2v nodes fill the same values`, () => {
      const t2v = build(n("text-to-video", p))
      expect(t2v.payload.aspectRatio).toBe("adaptive")
      expect(t2v.payload.resolution).toBe("720p")

      const i2v = build(n("image-to-video", p), { imageUrl: "https://cdn.example/first.png" })
      expect(i2v.payload.aspectRatio).toBe("adaptive")
      expect(i2v.payload.resolution).toBe("720p")
    })
  }

  it("providers with no declared default keep their historical fill", () => {
    // seedance-2 has no PRICING_DEFAULT_RESOLUTION row, so it must still get
    // its first catalog tier — the wan branch cannot reprice anything live.
    const r = build(n("generate-video", "seedance-2"))
    expect(r.payload.aspectRatio).toBe("adaptive")
    expect(r.payload.resolution).toBe(MODEL_CATALOG["seedance-2"]?.resolutions?.[0])
    // ...and a provider outside both families gets no fill at all.
    const kling = build(n("generate-video", "kling"))
    expect(kling.payload.aspectRatio).toBeUndefined()
    expect(kling.payload.resolution).toBeUndefined()
  })
})
