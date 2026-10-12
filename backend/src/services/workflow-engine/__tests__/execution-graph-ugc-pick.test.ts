import { describe, expect, it } from "vitest"
import { computeGatedIds } from "../execution-graph.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const n = (id: string, type: string): SimpleNode => ({ id, type, data: { label: id } })
const e = (source: string, target: string, sourceHandle: string, targetHandle: string): SimpleEdge => ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle, targetHandle }) as SimpleEdge
const NODES = [n("script", "ugc-script"), n("creator", "ugc-creator"), n("clips", "ugc-clips"), n("clip", "ugc-clip"), n("join", "combine-videos"), n("site", "text-prompt")]
const EDGES = [e("site", "script", "prompt", "site"), e("script", "creator", "category", "category"), e("script", "clips", "plan", "plan"), e("creator", "clips", "creator", "creator"), e("clips", "clip", "clips", "clip"), e("clip", "join", "video-out", "in")]
const done = (output: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ status: "completed", output, ...extra }) as unknown as NodeExecutionState
const PAIR = [{ imageUrl: "https://cdn.example/a.png", record: { v: 1 } }, { imageUrl: "https://cdn.example/b.png", record: { v: 1 } }]

describe("the run-time gate: a UGC Creator waiting for a pick", () => {
  it("gates everything forward of it, even UGC Clips with its live script wire", () => {
    const gated = computeGatedIds(NODES, EDGES, { site: done({ text: "Acme" }), script: done({ ugcOutputs: { plan: "{}" } }), creator: done({ ugcCandidates: PAIR }) })
    expect([...gated.entries()].sort()).toEqual([["clip", "awaiting_pick"], ["clips", "awaiting_pick"], ["join", "awaiting_pick"]])
  })
  it("a creator handed on, one option, a saved pair or a continuation's seed gates nothing", () => {
    expect(computeGatedIds(NODES, EDGES, { creator: done({ ugcOutputs: { creator: "{}", image: "https://cdn.example/a.png" } }) }).size).toBe(0)
    expect(computeGatedIds(NODES, EDGES, { creator: done({ ugcCandidates: PAIR.slice(0, 1) }) }).size).toBe(0)
    expect(computeGatedIds(NODES, EDGES, { creator: done({ ugcCandidates: PAIR }, { fromSavedData: true }) }).size).toBe(0)
    expect(computeGatedIds(NODES, EDGES, { creator: done({ ugcCandidates: PAIR }, { seededFromExecution: "exec-0" }) }).size).toBe(0)
  })
  it("a node it already stamped is not returned again", () => {
    const states = { creator: done({ ugcCandidates: PAIR }), clips: { status: "skipped" } as NodeExecutionState }
    expect(computeGatedIds(NODES, EDGES, states).has("clips")).toBe(false)
  })
})

describe("the run-time gate: a UGC Creator waiting for a pick — the remaining rules", () => {
  it("a creator that failed holding the options a credits stop kept gates nothing (the run already stops there)", () => {
    const failed = { status: "failed", output: { ugcCandidates: PAIR } } as unknown as NodeExecutionState
    expect(computeGatedIds(NODES, EDGES, { creator: failed }).size).toBe(0)
  })
  it("only a UGC Creator waits: another node's output that happens to hold options gates nothing", () => {
    expect(computeGatedIds(NODES, EDGES, { script: done({ ugcCandidates: PAIR }) }).size).toBe(0)
  })
  it("a node beside the creator, fed by nothing it reaches, still runs", () => {
    const nodes = [...NODES, n("music", "generate-music"), n("mix", "mix-audio")]
    const edges = [...EDGES, e("site", "music", "prompt", "prompt"), e("music", "mix", "audio", "in")]
    const gated = computeGatedIds(nodes, edges, { creator: done({ ugcCandidates: PAIR }) })
    expect(gated.has("music")).toBe(false)
    expect(gated.has("mix")).toBe(false)
  })
  it("a field mapping from the creator reaches forward like a wire", () => {
    const mapped: SimpleNode = { id: "caption", type: "llm-chat", data: { label: "caption", fieldMappings: { prompt: { sourceNodeId: "creator" } } } }
    const gated = computeGatedIds([...NODES, mapped], EDGES, { creator: done({ ugcCandidates: PAIR }) })
    expect(gated.get("caption")).toBe("awaiting_pick")
  })
})
