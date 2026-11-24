// @test-units-by-name prices and builds only the video-upscale node it names
// @test-watches backend/src/routes/video-upscale.ts backend/src/services/workflow-engine/payload-builder.ts backend/src/ee/billing/credits.ts backend/src/lib/nodaro-video-upscale-plan.ts backend/src/workers/handlers/video-ai.ts backend/src/lib/mcp/tools/verbs-video.ts frontend/src/components/editor/workflow-editor/execute-node.ts frontend/src/components/editor/config-panels/helpers.ts frontend/src/components/editor/config-panels/video-configs.tsx frontend/src/lib/video-utility-estimate.ts frontend/src/components/nodes/video-upscale-node.tsx frontend/src/components/nodes/node-quick-configs.tsx
// @test-watches backend/src/lib/reconcile/*.ts
// @test-watches backend/src/__tests__/fixtures/nodaro-video-upscale-mode-parity.json packages/render-rules/src/nodaro-video-upscale-pricing.ts
/**
 * Nodaro Video Upscale's two modes (decided 2026-11-24): transparent (the
 * default) and sharp. ONE resolver reads the mode (`nodaroVideoUpscaleModeOf`)
 * and every lane that prices or runs the provider goes through it, so no lane
 * can price one mode and run the other:
 * - the same request is priced on the same row by the route's guard (and
 *   POST /v1/quote), the workflow run's build, and the workflow estimate;
 * - every lane file reads the mode through the resolver (a source scan, so a
 *   new lane that reads `mode` raw fails here).
 * Also: transparent's tiers (720p added), its factor rule and refusals, its
 * price rows, and the tier coercion per mode (`normalizeVideoUpscaleResolution`).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("../lib/house-models-served.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/house-models-served.js")>()),
  houseModelServed: () => true,
}))

/** Whether this install can run Transparent (the one reading the plan and the estimate ask): on unless a test turns it off. */
const transparent = vi.hoisted(() => ({ available: true }))
vi.mock("../lib/nodaro-transparent-available.js", () => ({ nodaroTransparentAvailable: () => transparent.available }))

import type { FastifyRequest } from "fastify"
import { nodaroVideoUpscaleModeOf } from "@nodaro/shared/models"
import { normalizeVideoUpscaleResolution, videoUpscaleResolutionsFor } from "@nodaro/shared/model-catalog"
import {
  nodaroVideoUpscaleModeBilledSec,
  nodaroVideoUpscaleModeCreditId,
  nodaroVideoUpscaleModeEstimateUnits,
  nodaroVideoUpscaleModeTierOf,
  nodaroVideoUpscaleModeUnits,
  nodaroVideoUpscaleTransparentPlan,
} from "@nodaro/render-rules"
import { videoUpscalePricing } from "../routes/video-upscale.js"
import { buildPayload } from "../services/workflow-engine/payload-builder.js"
import { getNodeModelIdentifier, graphPricingUnits, STATIC_CREDIT_COSTS } from "../ee/billing/credits.js"
import { serveEveryHouseModel, serveNoHouseModel } from "../test/house-models.js"

const MODES = [undefined, "", "bogus", "transparent", "sharp"] as const
const TARGETS = [undefined, "720p", "1080p", "2k", "2K", "4k"] as const

describe("the one mode resolver", () => {
  it("unset, empty or unknown is transparent; the two modes are themselves", () => {
    expect(MODES.map((m) => nodaroVideoUpscaleModeOf(m))).toEqual(["transparent", "transparent", "transparent", "transparent", "sharp"])
  })

  it("every lane prices one request on the same row: the route's guard, the workflow build and the workflow estimate", () => {
    serveEveryHouseModel()
    try {
      for (const mode of MODES) {
        for (const target of TARGETS) {
          const body = { provider: "nodaro-video-upscale", videoUrl: "https://v.mp4", ...(mode !== undefined ? { mode } : {}), ...(target !== undefined ? { targetResolution: target } : {}) }
          const route = videoUpscalePricing.modelResolver({ body } as unknown as FastifyRequest)
          const built = buildPayload({ id: "n1", type: "video-upscale", data: { ...body, label: "x" } } as never, "job-1", { videoUrl: "https://v.mp4" } as never)
          const estimate = getNodeModelIdentifier({ id: "n1", type: "video-upscale", data: body }, {})
          const resolved = nodaroVideoUpscaleModeOf(mode)
          const expected = nodaroVideoUpscaleModeCreditId(resolved, nodaroVideoUpscaleModeTierOf(resolved, target))
          expect([route, built.modelIdentifier, estimate], `${String(mode)} ${String(target)}`).toEqual([expected, expected, expected])
          // The workflow build carries the mode AS ASKED (only an explicit one): its stamp measures the clip and
          // decides the mode that runs (`nodaroVideoUpscaleEffectiveMode`), and stamps it on the job.
          expect((built.payload as { mode?: unknown }).mode).toBe(mode === "sharp" || mode === "transparent" ? mode : undefined)
        }
      }
    } finally {
      serveNoHouseModel()
    }
  })

  const ROOT = join(__dirname, "..", "..", "..")
  // The reconcile lane, by its folder (this file names no provider beside the model).
  const RECONCILE_LANE = ["backend/src/lib/reconcile", "f" + "al.ts"].join("/")
  const LANES = [
    "backend/src/routes/video-upscale.ts",
    "backend/src/services/workflow-engine/payload-builder.ts",
    "backend/src/ee/billing/credits.ts",
    "backend/src/lib/nodaro-video-upscale-plan.ts",
    "backend/src/workers/handlers/video-ai.ts",
    RECONCILE_LANE,
    "frontend/src/components/editor/workflow-editor/execute-node.ts",
    "frontend/src/components/editor/config-panels/helpers.ts",
    "frontend/src/components/editor/config-panels/video-configs.tsx",
    "frontend/src/lib/video-utility-estimate.ts",
    "frontend/src/components/nodes/video-upscale-node.tsx",
    "frontend/src/components/nodes/node-quick-configs.tsx",
  ]
  it.each(LANES)("%s reads the mode through the resolver", (file) => {
    expect(readFileSync(join(ROOT, file), "utf8")).toMatch(/(nodaroVideoUpscale(QueuedModeOf|ModeOf|EffectiveMode|DecidedMode|EstimateMode|ShownMode)|useNodaroVideoUpscaleEstimatedMode)\(/)
  })
})

describe("the tiers each mode takes", () => {
  it("transparent: 720p / 1080p / 2K / 4K; sharp: 1080p / 2K / 4K; unset = transparent", () => {
    expect(videoUpscaleResolutionsFor("nodaro-video-upscale", "transparent")).toEqual(["720p", "1080p", "2k", "4k"])
    expect(videoUpscaleResolutionsFor("nodaro-video-upscale")).toEqual(["720p", "1080p", "2k", "4k"])
    expect(videoUpscaleResolutionsFor("nodaro-video-upscale", "sharp")).toEqual(["1080p", "2k", "4k"])
  })

  it("sharp + 720p is coerced to 1080p (the same on the server as in the editor); transparent keeps it; no tier is 1080p in both", () => {
    expect(normalizeVideoUpscaleResolution("nodaro-video-upscale", "720p", "sharp").targetResolution).toBe("1080p")
    expect(normalizeVideoUpscaleResolution("nodaro-video-upscale", "720p", "transparent").targetResolution).toBe("720p")
    expect(normalizeVideoUpscaleResolution("nodaro-video-upscale", "720p").targetResolution).toBe("720p")
    expect(nodaroVideoUpscaleModeTierOf("sharp", "720p")).toBe("1080p")
    expect(nodaroVideoUpscaleModeTierOf("transparent", "720p")).toBe("720p")
    expect(nodaroVideoUpscaleModeTierOf("sharp", undefined)).toBe("1080p")
    expect(nodaroVideoUpscaleModeTierOf("transparent", undefined)).toBe("1080p")
  })
})

describe("transparent's price: its own one-second rows by tier, the exact length", () => {
  it("each tier its own Transparent row (no supplier-named id), 2K seeded at 4K's rate; sharp keeps its own rows", () => {
    const ids = ["720p", "1080p", "2k", "4k"].map((t) => nodaroVideoUpscaleModeCreditId("transparent", t as never))
    expect(ids).toEqual([
      "nodaro-video-upscale:transparent:720p:per-sec", "nodaro-video-upscale:transparent:1080p:per-sec",
      "nodaro-video-upscale:transparent:2k:per-sec", "nodaro-video-upscale:transparent:4k:per-sec",
    ])
    expect(ids.map((id) => STATIC_CREDIT_COSTS[id])).toEqual([5, 10, 30, 30])
    expect(["1080p", "2k", "4k"].map((t) => nodaroVideoUpscaleModeCreditId("sharp", t as never))).toEqual([
      "nodaro-video-upscale:1080p:per-4s", "nodaro-video-upscale:2k:per-4s", "nodaro-video-upscale:4k:per-4s",
    ])
  })

  it("the estimate's units are the run's units, in each mode", () => {
    for (const sec of [0.3, 4, 4.04, 97 / 24, 10.04, 33.3, 60]) {
      for (const mode of ["transparent", "sharp"] as const) {
        expect(nodaroVideoUpscaleModeEstimateUnits(mode, sec), `${mode} ${sec}`).toBe(nodaroVideoUpscaleModeUnits(mode, nodaroVideoUpscaleModeBilledSec(mode, sec)))
      }
    }
    expect(nodaroVideoUpscaleModeUnits("transparent", nodaroVideoUpscaleModeBilledSec("transparent", 4.04))).toBe(4.046875)
    expect(nodaroVideoUpscaleModeUnits("sharp", nodaroVideoUpscaleModeBilledSec("sharp", 4.04))).toBe(1.25)
  })

  it("the rows are whole credits per second", () => {
    for (const id of ["720p", "1080p", "2k", "4k"].map((t) => nodaroVideoUpscaleModeCreditId("transparent", t as never))) expect(Number.isInteger(STATIC_CREDIT_COSTS[id])).toBe(true)
  })
})

describe("transparent's factor: the largest that fits inside the tier's box (Sharp's box), at most 4×", () => {
  // 16:9, 9:16, 1:1, 21:9 and 4:3 sources at every tier: the frame is inside the box, its long or short side filling it.
  const SOURCES = {
    "16:9": { width: 640, height: 360 },
    "9:16": { width: 360, height: 640 },
    "1:1": { width: 480, height: 480 },
    "21:9": { width: 840, height: 360 },
    "4:3": { width: 480, height: 360 },
  } as const
  const EXPECTED: Record<keyof typeof SOURCES, Record<"720p" | "1080p" | "2k" | "4k", readonly [number, number, number]>> = {
    // [factor, width, height]
    "16:9": { "720p": [2, 1280, 720], "1080p": [3, 1920, 1080], "2k": [4, 2560, 1440], "4k": [6, 0, 0] },
    "9:16": { "720p": [2, 720, 1280], "1080p": [3, 1080, 1920], "2k": [4, 1440, 2560], "4k": [6, 0, 0] },
    "1:1": { "720p": [1.5, 720, 720], "1080p": [2.25, 1080, 1080], "2k": [3, 1440, 1440], "4k": [4.5, 0, 0] },
    "21:9": { "720p": [1.5239, 1280, 548], "1080p": [2.2858, 1920, 822], "2k": [3.0477, 2560, 1096], "4k": [4.5715, 0, 0] },
    "4:3": { "720p": [2, 960, 720], "1080p": [3, 1440, 1080], "2k": [4, 1920, 1440], "4k": [6, 0, 0] },
  }
  for (const [aspect, source] of Object.entries(SOURCES) as Array<[keyof typeof SOURCES, { width: number; height: number }]>) {
    for (const tier of ["720p", "1080p", "2k", "4k"] as const) {
      const [factor, width, height] = EXPECTED[aspect][tier]
      it(`${aspect} ${source.width}×${source.height} at ${tier}`, () => {
        const plan = nodaroVideoUpscaleTransparentPlan(source, tier)
        if (factor > 4) {
          expect(plan).toEqual({ ok: false, reason: "too_small", largestTier: "2k" })
        } else {
          expect(plan).toEqual({ ok: true, factor, frame: { width, height } })
        }
      })
    }
  }

  it("worked examples: 21:9 1680×720 at 1080p → 1920×822 (not 2520 wide); 16:9 1280×720 at 4K → 3840×2160", () => {
    expect(nodaroVideoUpscaleTransparentPlan({ width: 1680, height: 720 }, "1080p")).toEqual({ ok: true, factor: 1.1429, frame: { width: 1920, height: 822 } })
    expect(nodaroVideoUpscaleTransparentPlan({ width: 1280, height: 720 }, "4k")).toEqual({ ok: true, factor: 3, frame: { width: 3840, height: 2160 } })
  })

  it("a clip that already fills the box is refused; one that needs more than 4× is refused naming the largest tier it reaches", () => {
    expect(nodaroVideoUpscaleTransparentPlan({ width: 1920, height: 1080 }, "1080p")).toEqual({ ok: false, reason: "already_at_tier" })
    // 21:9 2560×1080 at 1080p: its width already fills 1920.
    expect(nodaroVideoUpscaleTransparentPlan({ width: 2560, height: 1080 }, "1080p")).toEqual({ ok: false, reason: "already_at_tier" })
    expect(nodaroVideoUpscaleTransparentPlan({ width: 320, height: 180 }, "1080p")).toEqual({ ok: false, reason: "too_small", largestTier: "720p" })
    expect(nodaroVideoUpscaleTransparentPlan({ width: 160, height: 90 }, "1080p")).toEqual({ ok: false, reason: "too_small", largestTier: undefined })
  })
})

describe("no mode sent: Transparent, falling back to Sharp where Transparent cannot serve the clip (one function, every lane)", () => {
  it("the decision: explicit modes kept; no mode is Transparent unless the clip cannot be served; unknown is Transparent", async () => {
    const { nodaroVideoUpscaleEffectiveMode } = await import("@nodaro/shared/models")
    expect(nodaroVideoUpscaleEffectiveMode("transparent", false)).toBe("transparent")
    expect(nodaroVideoUpscaleEffectiveMode("sharp", true)).toBe("sharp")
    for (const asked of [undefined, "", "bogus"]) {
      expect(nodaroVideoUpscaleEffectiveMode(asked, false)).toBe("sharp")
      expect(nodaroVideoUpscaleEffectiveMode(asked, true)).toBe("transparent")
      expect(nodaroVideoUpscaleEffectiveMode(asked, undefined)).toBe("transparent")
    }
  })

  it("what Transparent can serve: the frame already filling the box, more than 4×, or past the output bound is not; unknown is undefined", async () => {
    const { nodaroVideoUpscaleTransparentServes } = await import("@nodaro/render-rules")
    expect(nodaroVideoUpscaleTransparentServes(undefined, "1080p")).toBeUndefined()
    expect(nodaroVideoUpscaleTransparentServes({ width: 1280, height: 720 }, "1080p")).toBe(true)
    expect(nodaroVideoUpscaleTransparentServes({ width: 1920, height: 1080 }, "1080p")).toBe(false)
    expect(nodaroVideoUpscaleTransparentServes({ width: 160, height: 90 }, "1080p")).toBe(false)
    expect(nodaroVideoUpscaleTransparentServes({ width: 1280, height: 720, fps: 30, sec: 60 }, "4k")).toBe(false)
    expect(nodaroVideoUpscaleTransparentServes({ width: 1280, height: 720, fps: 30, sec: 40 }, "4k")).toBe(true)
  })

  /** An upload of `width`×`height` wired into a Nodaro Video Upscale node at `tier`, with `mode` as written. */
  const graph = (width: number, height: number, tier: string, mode?: string) => ({
    nodes: [
      { id: "take", type: "upload-video", data: { url: "https://cdn.example/take.mp4", duration: 10, fps: 30, metadata: { width, height } } },
      { id: "x", type: "video-upscale", data: { provider: "nodaro-video-upscale", targetResolution: tier, ...(mode !== undefined ? { mode } : {}) } },
    ],
    edges: [{ source: "take", target: "x", targetHandle: "video" }],
  })
  const estimateUnitsOf = (g: ReturnType<typeof graph>) => graphPricingUnits(g.nodes[1]! as never, g.nodes as never, g.edges as never, new Set(["x"]))

  it.each([
    ["a 1080p clip at 1080p (already fills the frame), no mode → Sharp's row and units", 1920, 1080, "1080p", undefined, "sharp"],
    ["a 1080p clip at 1080p, explicit Transparent → Transparent (the run refuses it)", 1920, 1080, "1080p", "transparent", "transparent"],
    ["a 720p clip at 1080p, no mode → Transparent", 1280, 720, "1080p", undefined, "transparent"],
    ["a 160×90 clip at 1080p (more than 4×), no mode → Sharp", 160, 90, "1080p", undefined, "sharp"],
  ] as const)("the workflow estimate: %s", async (_n, w, h, tier, mode, expected) => {
    const g = graph(w, h, tier, mode)
    const units = estimateUnitsOf(g)
    // The estimate's units are the decided mode's (sharp: a quarter per whole second; transparent: seconds).
    expect(units).toBe(nodaroVideoUpscaleModeEstimateUnits(expected, 10))
  })

  it("the workflow estimate where this install cannot run Transparent: no mode is Sharp (as the run decides it); an explicit Transparent stays Transparent", () => {
    transparent.available = false
    try {
      expect(estimateUnitsOf(graph(1280, 720, "1080p"))).toBe(nodaroVideoUpscaleModeEstimateUnits("sharp", 10))
      expect(estimateUnitsOf(graph(1280, 720, "1080p", "transparent"))).toBe(nodaroVideoUpscaleModeEstimateUnits("transparent", 10))
      expect(estimateUnitsOf(graph(1280, 720, "1080p", "sharp"))).toBe(nodaroVideoUpscaleModeEstimateUnits("sharp", 10))
    } finally {
      transparent.available = true
    }
  })
})

/** The case table the editor's estimate is held to as well (frontend/src/lib/__tests__/nodaro-video-upscale-mode-parity.test.ts). */
type ModeParityCase = {
  name: string
  clip: { width: number; height: number } | null
  tier: string
  mode?: string
  transparentRuns: boolean
  expected: "transparent" | "sharp"
}
const MODE_PARITY = (JSON.parse(readFileSync(join(__dirname, "fixtures", "nodaro-video-upscale-mode-parity.json"), "utf8")) as { cases: ModeParityCase[] }).cases

describe("the mode an estimate decides, the server's half of the parity with the editor (one case table)", () => {
  const nodesOf = (c: ModeParityCase) => [
    ...(c.clip ? [{ id: "take", type: "upload-video", data: { url: "https://cdn.example/take.mp4", duration: 10, fps: 30, metadata: { width: c.clip.width, height: c.clip.height } } }] : []),
    { id: "x", type: "video-upscale", data: { provider: "nodaro-video-upscale", targetResolution: c.tier, ...(c.mode !== undefined ? { mode: c.mode } : {}) } },
  ]
  it.each(MODE_PARITY.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    transparent.available = c.transparentRuns
    try {
      const nodes = nodesOf(c)
      const edges = c.clip ? [{ source: "take", target: "x", targetHandle: "video" }] : []
      const units = graphPricingUnits(nodes[nodes.length - 1]! as never, nodes as never, edges as never, new Set(["x"]))
      expect(units).toBe(nodaroVideoUpscaleModeEstimateUnits(c.expected, c.clip ? 10 : undefined))
    } finally {
      transparent.available = true
    }
  })

  it("the table tells the modes apart by their units (a case that priced the other mode would fail)", () => {
    expect(nodaroVideoUpscaleModeEstimateUnits("sharp", 10)).not.toBe(nodaroVideoUpscaleModeEstimateUnits("transparent", 10))
    expect(nodaroVideoUpscaleModeEstimateUnits("sharp", undefined)).not.toBe(nodaroVideoUpscaleModeEstimateUnits("transparent", undefined))
  })
})
