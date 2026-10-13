/**
 * A run set's price on a button or a badge: never waits for the server, shows
 * the editor's own figure marked as an estimate until the server's answer for
 * the UGC part lands, and is then the very figure the run's confirmation and
 * balance check use (one cached answer per video), each part times the runs of
 * the node that executes it.
 */
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import type { UgcRunEstimate } from "@/lib/api"

const h = vi.hoisted(() => ({ estimate: vi.fn() }))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ugcEstimateApi: (...a: unknown[]) => h.estimate(...a),
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }))
vi.mock("@/hooks/use-model-credit-cost", () => ({
  getCachedModelCredits: () => undefined,
  prefetchModelCreditCosts: async () => undefined,
}))
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasCredits: () => true,
}))

import { queryClient } from "@/lib/query-client"
import { useRunSetCredits, useRunSetPrice } from "../use-run-from-here-credits"
import { estimateRunCredits } from "@/components/editor/workflow-editor/estimate-run-credits"
import { runUpToHereSet } from "@/components/editor/workflow-editor/run-up-to-here-set"
import { runCreditsWithUgc } from "@/components/editor/workflow-editor/ugc-run-estimate"

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

const n = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const e = (source: string, target: string, targetHandle: string, sourceHandle?: string) =>
  ({ id: `${source}->${target}:${targetHandle}`, source, target, targetHandle, ...(sourceHandle ? { sourceHandle } : {}) }) as unknown as WorkflowEdge

// The template's UGC chain, nothing run yet; Speaker View reads the captioned video.
const NODES = [
  n("site", "text-prompt", { text: "Acme" }),
  n("shot1", "upload-image", { url: "https://cdn.example/1.png" }),
  n("script", "ugc-script", { targetDurationSec: 15 }),
  n("creator", "ugc-creator", { source: "sampled", gender: "woman" }),
  n("clips", "ugc-clips"), n("clip", "ugc-clip", { rerender: {} }), n("cards", "ugc-cards"),
  n("join", "combine-videos", { transition: "cut" }), n("overlay", "video-overlay"), n("captions", "add-captions"),
  n("sv", "speaker-view"),
]
const EDGES = [
  e("site", "script", "site"), e("shot1", "script", "screenshot"), e("script", "creator", "category"),
  e("script", "clips", "plan"), e("creator", "clips", "creator"), e("clips", "clip", "clip"),
  e("clip", "join", "in"), e("clip", "cards", "notes"), e("join", "cards", "video"), e("join", "overlay", "video"),
  // The caption wire reads the cards' caption plan (an edge without a source pip reads the layer plan).
  e("cards", "overlay", "layerPlan"), e("cards", "captions", "captionPlan", "captionPlan"), e("overlay", "captions", "in"),
  e("captions", "sv", "video"),
]
const PARTS = { script: 22, creator: 41, clip: 1503, cards: 57, join: 11, overlay: 22, captions: 55 }
const HOLD = { ...PARTS, clip: 2 * 1803 }
const ANSWER: UgcRunEstimate = { lines: [], expected: 1711, ceiling: 3214, range: [1400, 2000], worstCase: 3800, parts: PARTS, holdParts: HOLD }
const SERVER = Object.values(PARTS).reduce((a, b) => a + b, 0)
const SERVER_HOLD = Object.values(HOLD).reduce((a, b) => a + b, 0)
const UP_TO_SV = runUpToHereSet("sv", NODES, EDGES).executable
const CLIENT = estimateRunCredits(UP_TO_SV, NODES, EDGES, () => undefined)

beforeEach(() => {
  queryClient.clear()
  h.estimate.mockReset()
})
afterEach(() => {
  queryClient.clear()
})

describe("useRunSetPrice", () => {
  it("while the server's figure is on its way: the editor's own, marked; once it lands: the server's", async () => {
    let land!: (v: unknown) => void
    h.estimate.mockReturnValue(new Promise((resolve) => { land = resolve }))
    const { result } = renderHook(() => useRunSetPrice(UP_TO_SV, NODES, EDGES), { wrapper })
    expect(result.current).toEqual({ credits: CLIENT, hold: CLIENT, estimating: true, unchecked: "checking" })
    expect(CLIENT).not.toBe(SERVER)
    land(ANSWER)
    await waitFor(() => expect(result.current).toEqual({ credits: SERVER, hold: SERVER_HOLD, estimating: false }))
    expect(h.estimate).toHaveBeenCalledTimes(1)
    expect(h.estimate.mock.calls[0]![0]).toMatchObject({ rendersEveryCandidate: true })
  })

  it("when it cannot be had: the editor's own figure, still marked", async () => {
    h.estimate.mockRejectedValue(new Error("503"))
    const { result } = renderHook(() => useRunSetPrice(UP_TO_SV, NODES, EDGES), { wrapper })
    await waitFor(() => expect(h.estimate).toHaveBeenCalled())
    await waitFor(() => expect(queryClient.getQueryCache().getAll().some((q) => q.state.status === "error")).toBe(true))
    await waitFor(() => expect(result.current).toEqual({ credits: CLIENT, hold: CLIENT, estimating: true, unchecked: "editor" }))
  })

  it("an older answer whose re-check failed: still its figure, marked", async () => {
    h.estimate.mockResolvedValueOnce(ANSWER)
    const { result } = renderHook(() => useRunSetPrice(UP_TO_SV, NODES, EDGES), { wrapper })
    await waitFor(() => expect(result.current.estimating).toBe(false))
    // The answer is six minutes old; the confirmation's re-check fails.
    const key = queryClient.getQueryCache().getAll()[0]!.queryKey
    queryClient.setQueryData(key, ANSWER, { updatedAt: Date.now() - 6 * 60_000 })
    h.estimate.mockRejectedValueOnce(new Error("503"))
    const priced = await runCreditsWithUgc(UP_TO_SV, NODES, EDGES, () => undefined)
    expect(priced).toMatchObject({ credits: SERVER, unchecked: "held" })
    await waitFor(() => expect(result.current).toEqual({ credits: SERVER, hold: SERVER_HOLD, estimating: true, unchecked: "held" }))
  })

  it("a List of three into UGC Script: three scripts, on the button and in the confirmation alike", async () => {
    const nodes = [n("list", "list", { items: "a\nb\nc" }), n("script", "ugc-script", { targetDurationSec: 15 })]
    const edges = [e("list", "script", "site")]
    h.estimate.mockResolvedValue(ANSWER)
    const { result } = renderHook(() => useRunSetPrice([nodes[1]!], nodes, edges), { wrapper })
    await waitFor(() => expect(result.current).toEqual({ credits: 3 * PARTS.script, hold: 3 * PARTS.script, estimating: false }))
    expect((await runCreditsWithUgc([nodes[1]!], nodes, edges, () => undefined)).credits).toBe(3 * PARTS.script)
  })

  it("Content Ideas into UGC Script: five scripts at its default count", async () => {
    const nodes = [n("ideas", "content-ideas"), n("script", "ugc-script", { targetDurationSec: 15 })]
    const edges = [e("ideas", "script", "site")]
    h.estimate.mockResolvedValue(ANSWER)
    expect((await runCreditsWithUgc([nodes[1]!], nodes, edges, () => undefined)).credits).toBe(5 * PARTS.script)
  })

  it("a set with no UGC part never asks and is never marked", () => {
    const nodes = [n("img", "generate-image", { provider: "p" })]
    const { result } = renderHook(() => useRunSetPrice(nodes, nodes, []), { wrapper })
    const own = estimateRunCredits(nodes, nodes, [], () => undefined)
    expect(result.current).toEqual({ credits: own, hold: own, estimating: false })
    expect(h.estimate).not.toHaveBeenCalled()
  })

  it("one figure for the Run up to here set: the button's, once the answer lands, is the run's confirmation's and gate's", async () => {
    h.estimate.mockResolvedValue(ANSWER)
    const { result } = renderHook(
      () => ({ price: useRunSetPrice(UP_TO_SV, NODES, EDGES), credits: useRunSetCredits(UP_TO_SV, NODES, EDGES) }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.price.estimating).toBe(false))
    const priced = await runCreditsWithUgc(UP_TO_SV, NODES, EDGES, () => undefined)
    expect(priced).toMatchObject({ credits: SERVER, hold: SERVER_HOLD, rendersClips: true, mayReuseClips: false })
    expect(priced).not.toHaveProperty("unchecked")
    expect(result.current.price.credits).toBe(priced.credits)
    expect(result.current.credits).toBe(priced.credits)
    // One answer for all of them.
    expect(h.estimate).toHaveBeenCalledTimes(1)
  })

  it("an answer the confirmation's own ask brought is the button's too", async () => {
    h.estimate.mockResolvedValue(ANSWER)
    const priced = await runCreditsWithUgc(UP_TO_SV, NODES, EDGES, () => undefined)
    const { result } = renderHook(() => useRunSetPrice(UP_TO_SV, NODES, EDGES), { wrapper })
    expect(result.current).toEqual({ credits: priced.credits, hold: priced.hold, estimating: false })
    expect(h.estimate).toHaveBeenCalledTimes(1)
  })
})
