/**
 * AUDIO SYNC — the price table, and the estimate agreeing with the reservation.
 *
 * Priced per source ALIGNED to the reference (decided 2026-09-25):
 * `audio-sync:<n>src` = 10 × (n − 1) for n = 2..6. Three lanes name the row:
 * the route (from the body's `sources.length` — pinned in
 * routes/__tests__/audio-sync.test.ts), the workflow run (buildPayload, from the
 * wired sources) and the pre-run estimate (estimateWorkflowCredits, from the
 * edges). The last two are driven here through their REAL paths over the same
 * graphs: the real `resolveNodeInputs` into the real `buildPayload`, whose
 * `modelIdentifier` IS what the run reserves, against the public estimator.
 *
 * THE INVARIANT: the estimate is never BELOW the reservation. Without edges the
 * estimator cannot count the sources, so it quotes the 6-source ceiling.
 */
import { describe, it, expect } from "vitest"
import { CREDIT_COSTS, STATIC_CREDIT_COSTS, estimateWorkflowCredits } from "../credits.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"
import { resolveNodeInputs } from "../../../services/workflow-engine/input-resolver.js"
import type { SimpleNode, SimpleEdge } from "../../../services/workflow-engine/types.js"
import {
  AUDIO_SYNC_CREDIT_COSTS,
  audioSyncCreditId,
  audioSyncCredits,
} from "../../../lib/audio-sync-credit-id.js"

const SYNC = "sync"

function upload(id: string, kind: "audio" | "video"): SimpleNode {
  return kind === "audio"
    ? { id, type: "upload-audio", data: { label: id, url: `https://media.test/${id}.m4a` } }
    : { id, type: "upload-video", data: { label: id, url: `https://media.test/${id}.mp4` } }
}

function graphOf(recordings: ReadonlyArray<readonly [string, "audio" | "video"]>, data: Record<string, unknown> = {}) {
  const nodes: SimpleNode[] = [
    ...recordings.map(([id, kind]) => upload(id, kind)),
    { id: SYNC, type: "audio-sync", data: { label: "Audio Sync", ...data } },
  ]
  const edges: SimpleEdge[] = recordings.map(([id, kind]) => ({
    id: `${id}->${SYNC}`,
    source: id,
    target: SYNC,
    sourceHandle: kind,
    targetHandle: "sources",
  }))
  return { nodes, edges }
}

/** The node's own quote: the whole-graph total minus the graph without it. */
function estimated(graph: { nodes: SimpleNode[]; edges: SimpleEdge[] }, withEdges = true): number {
  const edges = withEdges ? graph.edges : undefined
  return estimateWorkflowCredits(graph.nodes, edges) - estimateWorkflowCredits(graph.nodes.filter((n) => n.id !== SYNC), edges)
}

function built(graph: { nodes: SimpleNode[]; edges: SimpleEdge[] }) {
  const node = graph.nodes.find((n) => n.id === SYNC)!
  const inputs = resolveNodeInputs(node, graph.edges, {}, graph.nodes)
  return buildPayload(node, "job-1", inputs, "usage-1")
}

describe("audio-sync price table", () => {
  it("10 × (sources − 1): 2 → 10, 3 → 20, 4 → 30, 5 → 40, 6 → 50", () => {
    expect(AUDIO_SYNC_CREDIT_COSTS).toEqual({
      "audio-sync:2src": 10,
      "audio-sync:3src": 20,
      "audio-sync:4src": 30,
      "audio-sync:5src": 40,
      "audio-sync:6src": 50,
    })
    for (const [id, credits] of Object.entries(AUDIO_SYNC_CREDIT_COSTS)) expect(STATIC_CREDIT_COSTS[id]).toBe(credits)
  })

  it("composites only — no bare node-type row (every lane names a composite)", () => {
    expect(STATIC_CREDIT_COSTS["audio-sync"]).toBeUndefined()
  })

  it("the builder clamps into 2..6 and reads an unknown count as the ceiling", () => {
    expect(audioSyncCreditId(0)).toBe("audio-sync:2src")
    expect(audioSyncCreditId(1)).toBe("audio-sync:2src")
    expect(audioSyncCreditId(4)).toBe("audio-sync:4src")
    expect(audioSyncCreditId(9)).toBe("audio-sync:6src")
    expect(audioSyncCreditId(Number.NaN)).toBe("audio-sync:6src")
    expect(audioSyncCredits(2)).toBe(10)
    expect(audioSyncCredits(6)).toBe(50)
  })

  it("CREDIT_COSTS resolves a request-shaped record's `sources` to the same row", () => {
    const resolve = CREDIT_COSTS["audio-sync"]!
    expect(resolve({ sources: [{}, {}, {}] })).toBe("audio-sync:3src")
    expect(resolve({})).toBe("audio-sync:6src")
  })
})

describe("audio-sync: the workflow estimate agrees with what the run reserves", () => {
  it.each([
    [2, 10],
    [4, 30],
    [6, 50],
  ])("%i wired recordings: estimate = reservation = %i credits", (n, credits) => {
    const graph = graphOf(Array.from({ length: n }, (_, i) => [`r${i}`, i % 2 === 0 ? "audio" : "video"] as const))
    const run = built(graph)
    expect(run.modelIdentifier).toBe(`audio-sync:${n}src`)
    expect(STATIC_CREDIT_COSTS[run.modelIdentifier!]).toBe(credits)
    expect(estimated(graph)).toBe(credits)
  })

  it("without edges the estimate quotes the 6-source ceiling — never below the reservation", () => {
    const graph = graphOf([["mic", "audio"], ["cam", "video"]])
    expect(estimated(graph, false)).toBe(50)
    expect(estimated(graph, false)).toBeGreaterThanOrEqual(STATIC_CREDIT_COSTS[built(graph).modelIdentifier!]!)
  })
})

describe("audio-sync payload (the workflow lane)", () => {
  it("sources = the wired recordings' NODE ids + media urls, audio and video alike; queued as audio-sync on the video worker", () => {
    const run = built(graphOf([["mic", "audio"], ["camA", "video"], ["camB", "video"]], { reference: "camA" }))
    expect(run.jobName).toBe("audio-sync")
    expect(run.queueName).toBe("video-generation")
    expect(run.payload).toEqual({
      jobId: "job-1",
      sources: [
        { id: "mic", url: "https://media.test/mic.m4a" },
        { id: "camA", url: "https://media.test/camA.mp4" },
        { id: "camB", url: "https://media.test/camB.mp4" },
      ],
      reference: "camA",
      usageLogId: "usage-1",
    })
  })

  it("the config-panel sourceOrder orders the sources (listed first, the rest in wire order)", () => {
    const run = built(graphOf([["mic", "audio"], ["camA", "video"], ["camB", "video"]], { sourceOrder: ["camB", "mic"] }))
    expect((run.payload.sources as Array<{ id: string }>).map((s) => s.id)).toEqual(["camB", "mic", "camA"])
  })

  it("a reference that is no longer wired falls back to the default (none sent → the first source)", () => {
    const run = built(graphOf([["mic", "audio"], ["cam", "video"]], { reference: "gone" }))
    expect(run.payload).not.toHaveProperty("reference")
  })

  it("fewer than two recordings refuses BEFORE the reserve, naming the node and the input", () => {
    expect(() => built(graphOf([["mic", "audio"]]))).toThrow(/audio-sync: node "Audio Sync" needs at least 2 recordings — connect them to the Sources input/)
    expect(() => built(graphOf([]))).toThrow(/needs at least 2 recordings/)
  })

  it("more than six recordings refuses before the reserve", () => {
    expect(() => built(graphOf(Array.from({ length: 7 }, (_, i) => [`r${i}`, "audio"] as const)))).toThrow(/takes at most 6 recordings — 7 are connected/)
  })
})
