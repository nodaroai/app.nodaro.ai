// @test-watches backend/src/__tests__/fixtures/nodaro-video-upscale-mode-parity.json
/**
 * A published app's run estimate (the live figure every runner surface prices
 * from, `useLiveRunFigure`) decides a Nodaro Video Upscale node's mode as the
 * server and the run do — over the one case table the server's estimate and
 * the editor's are held to — reading "can Transparent run here" from the
 * deployment's availability answer (`models.deniedModes`), and re-prices when
 * that answer lands. Before, the runner pages never loaded the answer, so a
 * node with no mode was quoted in Transparent on an install that cannot run
 * it, while the run took Sharp.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { scaledTimeout } from "../../../../tools/vitest/ci-limits.mjs"
import { act, renderHook, waitFor } from "@testing-library/react"
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

import { NODARO_VIDEO_UPSCALE_TRANSPARENT_MODE_ID, nodaroVideoUpscaleModeCreditId, nodaroVideoUpscaleModeTierOf } from "@nodaro/render-rules"
import { computeLiveRunEstimate, useLiveRunFigure } from "../use-live-run-estimate"
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

const answer = (transparentRuns: boolean) =>
  __resetSurfaceAvailabilityForTests({ nodes: [], models: [], modelModes: transparentRuns ? [] : [NODARO_VIDEO_UPSCALE_TRANSPARENT_MODE_ID] })

const graphOf = (c: Pick<ModeParityCase, "clip" | "tier" | "mode">): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } => {
  const node = { id: "x", type: "video-upscale", position: { x: 0, y: 0 }, data: { label: "x", provider: "nodaro-video-upscale", targetResolution: c.tier, ...(c.mode !== undefined ? { mode: c.mode } : {}) } } as unknown as WorkflowNode
  const take = c.clip
    ? ({ id: "take", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Take", url: "https://cdn.example/take.mp4", duration: 10, fps: 30, metadata: { width: c.clip.width, height: c.clip.height } } } as unknown as WorkflowNode)
    : undefined
  return {
    nodes: take ? [take, node] : [node],
    edges: take ? [{ id: "e", source: "take", target: "x", targetHandle: "video" } as WorkflowEdge] : [],
  }
}
const rowOf = (mode: "transparent" | "sharp", tier: string) => nodaroVideoUpscaleModeCreditId(mode, nodaroVideoUpscaleModeTierOf(mode, tier))
const other = (mode: "transparent" | "sharp") => (mode === "transparent" ? "sharp" : "transparent")

afterEach(() => __resetSurfaceAvailabilityForTests(null))

describe("the app runner's live estimate decides the mode the server and the run decide (one case table)", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    answer(c.transparentRuns)
    const { nodes, edges } = graphOf(c)
    const { uncachedModelIds } = computeLiveRunEstimate({ nodes, edges, inputValues: {} }, () => undefined)
    expect(uncachedModelIds).toContain(rowOf(c.expected, c.tier))
    expect(uncachedModelIds).not.toContain(rowOf(other(c.expected), c.tier))
  })
})

describe("the live figure re-prices when the availability answer lands", () => {
  it("a node with no mode: Transparent's price before the answer, Sharp's once it says Transparent cannot run", async () => {
    __resetSurfaceAvailabilityForTests(null)
    const { nodes, edges } = graphOf({ clip: null, tier: "1080p" })
    const transparentRow = rowOf("transparent", "1080p")
    const sharpRow = rowOf("sharp", "1080p")
    // Distinct per-unit prices, so the figure says which row it priced.
    const cache = new Map<string, number>([[transparentRow, 7], [sharpRow, 3]])
    const deps = { getCachedCredits: (id: string) => cache.get(id), prefetchModelCredits: vi.fn(async () => {}) }
    const args = { nodes, edges, inputValues: {}, enabled: true }
    const figureNow = () => computeLiveRunEstimate({ nodes, edges, inputValues: {} }, deps.getCachedCredits).total
    const transparentTotal = figureNow()
    expect(transparentTotal).toBeGreaterThan(0)

    const { result } = renderHook(() => useLiveRunFigure(args, deps))
    await waitFor(() => expect(result.current.total).toBe(transparentTotal))

    // The answer lands: nothing else changes, and the figure follows the run.
    act(() => { answer(false) })
    const sharpTotal = figureNow()
    expect(sharpTotal).not.toBe(transparentTotal)
    await waitFor(() => expect(result.current.total).toBe(sharpTotal), { timeout: scaledTimeout(2_000) })
  })
})
