import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import { applyDefaultVideoSelection, buildVideoCreditModelIdentifier } from "@nodaro/shared"
import { resolveVideoRequestNorm } from "../../../lib/video-request-norm.js"

// Mirrors ltx-dispatch.test.ts's harness — read that file and match its
// `buildCtx` construction and any module mocks it installs.
const node = (data: Record<string, unknown>) => ({
  id: "n1",
  type: "generate-video",
  data: { provider: "ltx-2.3-pro", prompt: "a cat", ...data },
})
const ctx = { nodes: [], edges: [], nodeStates: {} }
const build = (data: Record<string, unknown>, resolvedInputs: Record<string, unknown> = {}) =>
  buildPayload(node(data) as never, "job-1", resolvedInputs as never, undefined, ctx as never)

describe("LTX reserves the resolution×duration tier it renders", () => {
  it("prices 4k / 10s as the 4k:10s composite, not the bare id", () => {
    expect(build({ resolution: "4k", duration: 10 }).modelIdentifier).toBe("ltx-2.3-pro:4k:10s")
  })

  it("prices the Fast variant's long durations", () => {
    expect(build({ provider: "ltx-2.3-fast", resolution: "1080p", duration: 20 }).modelIdentifier)
      .toBe("ltx-2.3-fast:1080p:20s")
  })

  it("falls back to the 1080p band for an unknown resolution (never cheaper than the bare id)", () => {
    expect(build({ resolution: "720p", duration: 6 }).modelIdentifier).toBe("ltx-2.3-pro:1080p:6s")
  })

  it("the reserved tier and the enqueued payload describe the same render", () => {
    const out = build({ resolution: "2k", duration: 8 })
    expect(out.modelIdentifier).toBe("ltx-2.3-pro:2k:8s")
    expect(out.payload.resolution).toBe("2k")
    expect(out.payload.duration).toBe(8)
  })
})

// Parity: the DAG lane's reservation must equal what the direct routes'
// creditGuard closures reserve for the SAME node data — `/v1/text-to-video`
// (text-to-video.ts:64-79, nodeType "text-to-video") for the t2v case, and
// `/v1/generate-video` (generate-video.ts:462-478, nodeType "image-to-video")
// for the i2v case; there is no standalone `image-to-video.ts` route file.
// Reproduces each closure's exact call shape rather than importing it — it's
// an inline arrow passed to creditGuard, not an exported symbol. sound/mode
// are always undefined and hasVideoRef always false for LTX (the branch
// ignores all three), so this is byte-for-byte the same computation the
// route performs.
//
// R3: Task 9 added the canonicalisation this test used to defer. Both lanes now
// run `resolveVideoRequestNorm` BEFORE the identifier, so an upper-cased "4K"
// reaches the case-sensitive `LTX_DURATION_TIERS` lookup as "4k" and prices the
// 4k band on BOTH sides instead of silently falling back to 1080p. Parity held
// before (both sides fell back alike) and holds now (both sides canonicalise
// alike) — what changed is that the fallback is no longer reached for a spelling
// the user plainly meant. (The UI dropdown only ever emits lowercase — see
// model-options.ts's VIDEO_RESOLUTION_OPTIONS — so "4K" reaches this code only
// via a bypass of the picker: a hand-built API/webhook/import payload.)
describe("LTX DAG reservation matches the direct-route reservation (parity)", () => {
  const routeIdentifier = (
    resolution: string | undefined,
    nodeType: "text-to-video" | "image-to-video" = "text-to-video",
  ) => {
    const sel = applyDefaultVideoSelection({ provider: "ltx-2.3-pro", duration: undefined as number | string | undefined })
    // Mirrors the routes' preHandler exactly: normalize first, then build the
    // identifier from the normalized values (text-to-video.ts / generate-video.ts).
    const norm = resolveVideoRequestNorm({ provider: sel.provider, resolution, duration: sel.duration })
    return buildVideoCreditModelIdentifier(
      sel.provider,
      norm.duration ?? sel.duration,
      undefined,
      nodeType,
      undefined,
      norm.resolution,
      false,
    )
  }

  const cases: Array<string | undefined> = ["4k", "4K", "1080p", undefined]

  it.each(cases)("t2v: route and DAG agree for resolution=%s", (resolution) => {
    const dagIdentifier = build({ resolution }).modelIdentifier
    expect(dagIdentifier).toBe(routeIdentifier(resolution))
  })

  it.each(cases)("i2v: route (generate-video.ts) and DAG agree for resolution=%s", (resolution) => {
    // Wiring a startFrame flips the DAG branch's `task` to "image_to_video",
    // which flips its buildVideoCreditModelIdentifier call to nodeType
    // "image-to-video" — mirroring /v1/generate-video, not /v1/text-to-video.
    const dagIdentifier = build({ resolution }, { startFrameUrl: "https://cdn.example/a.png" }).modelIdentifier
    expect(dagIdentifier).toBe(routeIdentifier(resolution, "image-to-video"))
  })

  it("canonicalises case before the identifier keys on it — '4K' now prices the 4k band on BOTH sides", () => {
    expect(routeIdentifier("4k")).toBe("ltx-2.3-pro:4k:6s")
    // Was "ltx-2.3-pro:1080p:6s" before Task 9: the uppercase key missed
    // LTX_DURATION_TIERS' lowercase lookup and fell back to the cheapest band,
    // so a 4K request rendered 4K (snapLtxInput's own fallback aside) while
    // billing 1080p. Now canonicalised once, upstream of every identifier site.
    expect(routeIdentifier("4K")).toBe("ltx-2.3-pro:4k:6s")
    expect(routeIdentifier("1080p")).toBe("ltx-2.3-pro:1080p:6s")
    expect(routeIdentifier(undefined)).toBe("ltx-2.3-pro:1080p:6s")
  })
})

/**
 * Seedance 2.5 in the DAG lane: a DELIBERATE reprice, pinned here so it cannot
 * happen again by accident.
 *
 * `video-ui-defaults.ts` fills `resolutions[0]` = "480p" for an untouched
 * seedance node, and that fill is what the worker has always been SENT. But the
 * identifier used to be built from raw `data.resolution` (undefined), which the
 * seedance branch prices at its declared PRICING_DEFAULT_RESOLUTION of 720p. So
 * the DAG reserved the 720p row (1260 cr) for a render it explicitly requested
 * at 480p (560 cr) — the user was charged 2.25× for the cheaper tier.
 *
 * Task 9's invariant is that the priced value IS the sent value, so the two now
 * agree at 480p — the tier actually rendered. `video-ui-defaults.ts` warns "do
 * not align the branches without repricing it deliberately"; this IS that
 * deliberate alignment, in the direction of what the provider is asked to make.
 *
 * The remaining question is a product one, not a correctness one: if seedance
 * nodes SHOULD render 720p, change `uiResolutionFill` to the declared default
 * and both numbers move to 720p together. Either way price and wire now match.
 */
describe("seedance-2-5 DAG nodes price the tier they actually request", () => {
  const seedanceNode = (nodeType: string, data: Record<string, unknown>) => ({
    id: "n1",
    type: nodeType,
    data: { provider: "seedance-2-5", prompt: "a cat", duration: 8, ...data },
  })
  const buildSeedance = (
    data: Record<string, unknown> = {},
    resolvedInputs: Record<string, unknown> = {},
    nodeType = "generate-video",
  ) =>
    buildPayload(seedanceNode(nodeType, data) as never, "job-1", resolvedInputs as never, undefined, ctx as never)

  // All THREE video branches carry the same ui-fill, so all three had the same
  // price-vs-wire split. The unified branch is the one users hit today; the two
  // legacy branches still serve saved workflows, so pin every one.
  const BRANCHES: Array<[string, string, Record<string, unknown>]> = [
    ["unified (generate-video)", "generate-video", {}],
    ["legacy i2v (image-to-video)", "image-to-video", { imageUrl: "https://cdn.example/a.png" }],
    ["legacy t2v (text-to-video)", "text-to-video", {}],
  ]

  for (const [label, nodeType, resolvedInputs] of BRANCHES) {
    it(`${label}: an untouched node reserves the 480p row it sends, not the 720p row it does not`, () => {
      const out = buildSeedance({}, resolvedInputs, nodeType)
      expect(out.payload.resolution, label).toBe("480p")
      // Was "seedance-2-5:8s:720p" — priced 1260 cr against a 480p (560 cr) render.
      expect(out.modelIdentifier, label).toBe("seedance-2-5:8s:480p")
    })
  }

  it("an explicit resolution is priced and sent unchanged", () => {
    const out = buildSeedance({ resolution: "1080p" })
    expect(out.payload.resolution).toBe("1080p")
    expect(out.modelIdentifier).toBe("seedance-2-5:8s:1080p")
  })

  it("the ui aspect fill still survives normalization (R5)", () => {
    expect(buildSeedance().payload.aspectRatio).toBe("adaptive")
  })
})
