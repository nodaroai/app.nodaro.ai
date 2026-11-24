// @test-watches backend/src/__tests__/fixtures/nodaro-video-upscale-mode-parity.json
/**
 * The editor's half of the Nodaro Video Upscale mode parity: over the case
 * table the server's estimate is held to (its half is
 * backend/src/__tests__/nodaro-video-upscale-modes.test.ts), the editor's
 * estimate decides the same mode, prices it on that mode's row and units, and
 * reads "can Transparent run" from the deployment's availability answer
 * (`models.deniedModes`) — true until the answer lands, as before it carried it.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

vi.mock("@/hooks/use-model-credit-cost", () => ({
  isModelRefused: () => false,
  isModelEstimate: () => false,
  refusedModelMessage: () => undefined,
  getCachedModelCredits: () => undefined,
  prefetchModelCreditCosts: vi.fn(async () => {}),
  isModelUnpriced: () => false,
  useModelCreditCost: vi.fn(),
  useModelCredits: () => 0,
  fetchModelCredits: vi.fn(),
}))

import { NODARO_VIDEO_UPSCALE_TRANSPARENT_MODE_ID, nodaroVideoUpscaleModeCreditId, nodaroVideoUpscaleModeEstimateUnits, nodaroVideoUpscaleModeTierOf } from "@nodaro/render-rules"
import { nodaroTransparentRunsHere, nodaroVideoUpscaleEstimateMode, nodaroVideoUpscaleShownMode, videoUpscalePricingUnits } from "@/lib/video-utility-estimate"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

type ModeParityCase = {
  name: string
  clip: { width: number; height: number } | null
  tier: string
  mode?: string
  transparentRuns: boolean
  expected: "transparent" | "sharp"
}
const HERE = dirname(fileURLToPath(import.meta.url))
const CASES = (JSON.parse(readFileSync(join(HERE, "../../../../backend/src/__tests__/fixtures/nodaro-video-upscale-mode-parity.json"), "utf8")) as { cases: ModeParityCase[] }).cases

/** The deployment's availability answer, with Transparent listed as a mode it cannot run or not. */
const answer = (transparentRuns: boolean) =>
  __resetSurfaceAvailabilityForTests({ nodes: [], models: [], modelModes: transparentRuns ? [] : [NODARO_VIDEO_UPSCALE_TRANSPARENT_MODE_ID] })

const graphOf = (c: ModeParityCase): { node: WorkflowNode; nodes: WorkflowNode[]; edges: WorkflowEdge[] } => {
  const node = { id: "x", type: "video-upscale", position: { x: 0, y: 0 }, data: { label: "x", provider: "nodaro-video-upscale", targetResolution: c.tier, ...(c.mode !== undefined ? { mode: c.mode } : {}) } } as unknown as WorkflowNode
  const take = c.clip
    ? ({ id: "take", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Take", url: "https://cdn.example/take.mp4", duration: 10, fps: 30, metadata: { width: c.clip.width, height: c.clip.height } } } as unknown as WorkflowNode)
    : undefined
  return {
    node,
    nodes: take ? [take, node] : [node],
    edges: take ? [{ id: "e", source: "take", target: "x", targetHandle: "video" } as WorkflowEdge] : [],
  }
}

afterEach(() => __resetSurfaceAvailabilityForTests(null))

describe("the mode an estimate decides, the editor's half of the parity with the server (one case table)", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    answer(c.transparentRuns)
    const { node, nodes, edges } = graphOf(c)
    expect(nodaroVideoUpscaleEstimateMode(node, nodes, edges)).toBe(c.expected)
    // Priced on that mode's row, at that mode's units: what the node's pill, its Run button and the run's confirm read.
    expect(getModelIdentifier(node, edges, nodes)).toBe(nodaroVideoUpscaleModeCreditId(c.expected, nodaroVideoUpscaleModeTierOf(c.expected, c.tier)))
    expect(videoUpscalePricingUnits(node, nodes, edges)).toBe(nodaroVideoUpscaleModeEstimateUnits(c.expected, c.clip ? 10 : undefined))
  })
})

describe("can Transparent run here: the deployment's answer, Transparent until it lands", () => {
  it("before the answer, after sign-out, and from a server that sends no modes: Transparent runs (today's behaviour)", () => {
    __resetSurfaceAvailabilityForTests(null)
    expect(nodaroTransparentRunsHere()).toBe(true)
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [] })
    expect(nodaroTransparentRunsHere()).toBe(true)
  })

  it("an answer that lists it: a node with no mode is priced on Sharp's row, and its Mode control shows Sharp", () => {
    answer(false)
    expect(nodaroTransparentRunsHere()).toBe(false)
    const { node, nodes, edges } = graphOf({ name: "", clip: { width: 1280, height: 720 }, tier: "1080p", transparentRuns: false, expected: "sharp" })
    expect(getModelIdentifier(node, edges, nodes)).toBe("nodaro-video-upscale:1080p:per-4s")
    // Priced with no graph at all: the same, the mode the run takes before it knows the clip.
    expect(getModelIdentifier(node)).toBe("nodaro-video-upscale:1080p:per-4s")
    expect(nodaroVideoUpscaleShownMode(undefined)).toBe("sharp")
    // A node that names Transparent keeps it (the run refuses it; the control says why).
    expect(nodaroVideoUpscaleShownMode("transparent")).toBe("transparent")
    answer(true)
    expect(nodaroVideoUpscaleShownMode(undefined)).toBe("transparent")
  })
})
