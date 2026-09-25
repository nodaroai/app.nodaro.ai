/**
 * Audio Sync's price on the canvas — and the invariant that every surface
 * quoting it names the SAME row, from the SAME count of wired recordings:
 *
 *   1. the node pill / Run button (audio-sync-node.tsx → audioSyncCreditId)
 *   2. the run-level estimate      (getModelIdentifier → live model-cost row)
 *   3. the cold-cache fallback     (estimateNodeCredits / estimateRunCredits →
 *                                   NODE_CREDIT_COSTS)
 *
 * Priced per source aligned to the reference: 10 × (sources − 1) —
 * 2 → 10, 4 → 30, 6 → 50. Without edges every surface quotes the 6-source
 * ceiling (an estimate may over-quote, never under-quote).
 *
 * Also pins the canvas input routing: each wired recording reaches the
 * executor with its upstream NODE id, audio and video alike.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/ee/hooks/use-model-credits", () => ({
  getCachedCredits: vi.fn(),
  getCachedVideoProCredits: vi.fn(),
}))

import { estimateNodeCredits, NODE_CREDIT_COSTS, EXECUTABLE_TYPES } from "../types"
import { estimateRunCredits } from "../estimate-run-credits"
import { resolveNodeInputs } from "../node-input-resolver"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const SYNC = "sync"

function node(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } } as WorkflowNode
}

function graph(n: number): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const recordings = Array.from({ length: n }, (_, i) =>
    i % 2 === 0
      ? node(`r${i}`, "upload-audio", { url: `https://m.test/r${i}.m4a`, audioUrl: `https://m.test/r${i}.m4a` })
      : node(`r${i}`, "upload-video", { url: `https://m.test/r${i}.mp4`, videoUrl: `https://m.test/r${i}.mp4` }),
  )
  const edges = recordings.map((r) => ({ id: `${r.id}->${SYNC}`, source: r.id, target: SYNC, targetHandle: "sources" }) as WorkflowEdge)
  return { nodes: [...recordings, node(SYNC, "audio-sync", { label: "Audio Sync" })], edges }
}

beforeEach(() => vi.clearAllMocks())

describe("audio-sync is executable", () => {
  it("is in EXECUTABLE_TYPES (else the Run button fails)", () => {
    expect(EXECUTABLE_TYPES.has("audio-sync")).toBe(true)
  })
})

describe("the run-level id and the cold-cache price follow the wired count", () => {
  it.each([
    [2, "audio-sync:2src", 10],
    [4, "audio-sync:4src", 30],
    [6, "audio-sync:6src", 50],
  ])("%i recordings → %s = %i credits, on every surface", (n, id, credits) => {
    const g = graph(n)
    const sync = g.nodes.find((x) => x.id === SYNC)!
    expect(getModelIdentifier(sync, g.edges, g.nodes)).toBe(id)
    expect(NODE_CREDIT_COSTS[id]).toBe(credits)
    expect(estimateNodeCredits(sync, g.edges)).toBe(credits)
    // Cold cache: the run estimate falls back to the same row.
    expect(estimateRunCredits([sync], g.nodes, g.edges, () => undefined)).toBe(credits)
    // Warm cache: it reads the live row the id names.
    expect(estimateRunCredits([sync], g.nodes, g.edges, (m) => (m === id ? 777 : undefined))).toBe(777)
  })

  it("without edges every surface quotes the 6-source ceiling", () => {
    const sync = node(SYNC, "audio-sync")
    expect(getModelIdentifier(sync)).toBe("audio-sync:6src")
    expect(estimateNodeCredits(sync)).toBe(50)
  })

  it("the fallback table carries all five rows at 10 × (n − 1)", () => {
    expect([2, 3, 4, 5, 6].map((n) => NODE_CREDIT_COSTS[`audio-sync:${n}src`])).toEqual([10, 20, 30, 40, 50])
  })
})

describe("canvas input routing", () => {
  it("each recording on `sources` keeps its upstream NODE id — audio and video alike, in wire order", () => {
    const g = graph(3)
    const sync = g.nodes.find((x) => x.id === SYNC)!
    const inputs = resolveNodeInputs(sync, g.nodes, g.edges)
    expect(inputs.audioSyncSources).toEqual([
      { nodeId: "r0", url: "https://m.test/r0.m4a" },
      { nodeId: "r1", url: "https://m.test/r1.mp4" },
      { nodeId: "r2", url: "https://m.test/r2.m4a" },
    ])
    // Nothing leaked into the single-media slots.
    expect(inputs.audioUrl).toBeUndefined()
    expect(inputs.videoUrl).toBeUndefined()
  })
})
