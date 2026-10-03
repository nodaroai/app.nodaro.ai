/**
 * THE ESTIMATE AND THE RESERVATION MUST AGREE ON ADD-CAPTIONS.
 *
 * A caption node's price is not a property of its type: a plain static subtitle
 * is an FFmpeg drawtext burn (`add-captions`), anything styled / timed /
 * transcribed / segmented is a Remotion render (`add-captions:kinetic`). Two
 * separate pieces of code decide that — `estimateWorkflowCredits` before the run
 * (it feeds a published app's advertised price and the monetization base) and
 * `buildPayload` at reservation time — and they see DIFFERENT things: the
 * estimator sees nodes + edges, the reservation sees the resolved inputs an edge
 * actually delivered. That asymmetry is exactly how a quote drifts below a
 * charge.
 *
 * So these tests run BOTH real paths over the same little graphs:
 *   estimate  = `CreditsService.estimateWorkflowBaseCredits(nodes, edges)` —
 *               the public estimate's own per-node pricing, at base prices
 *               (the markup is applied to both sides alike) — with the
 *               node's own quote read as the delta of the whole-graph total
 *               (no private helper is reached into).
 *   run       = the real `resolveNodeInputs` (what the orchestrator hands the
 *               builder) into the real `buildPayload`, whose `modelIdentifier`
 *               IS what the run reserves.
 *
 * THE INVARIANT, asserted on every case: the estimate is never BELOW the
 * reservation. Over-quoting is allowed where a graph fact is invisible before
 * the run (a `{Label}` text, no edges passed); under-quoting never is.
 */

import { describe, it, expect } from "vitest"
import { CreditsService, STATIC_CREDIT_COSTS } from "../credits.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"
import { resolveNodeInputs } from "../../../services/workflow-engine/input-resolver.js"
import type {
  SimpleNode,
  SimpleEdge,
  NodeExecutionState,
} from "../../../services/workflow-engine/types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATIC_ID = "add-captions"
const KINETIC_ID = "add-captions:kinetic"
const VIDEO_URL = "https://media.example.com/clip.mp4"

/** A one-word Transcript — enough that buildPayload's "has words" gate passes. */
const TRANSCRIPT = { version: 1, words: [{ text: "Hello", startMs: 0, endMs: 500 }] }

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

function edge(source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle: sourceHandle ?? null, targetHandle: targetHandle ?? null }
}

/** An add-captions node. Every one carries its video, so the only thing under
 *  test is which RENDERER (and price) the two paths pick. */
function captionsNode(data: Record<string, unknown>): SimpleNode {
  return node("ac1", "add-captions", { videoUrl: VIDEO_URL, ...data })
}

interface Graph {
  nodes: SimpleNode[]
  edges: SimpleEdge[]
  /** Upstream results, shaped the way the orchestrator leaves them. */
  states?: Record<string, NodeExecutionState>
}

/**
 * What the ESTIMATE charges for the caption node, read through the public API:
 * the whole-graph total minus the same graph without that node. Every other
 * node's price is node-local, so the delta is exactly this node's quote.
 */
function estimatedCaptionCredits(graph: Graph, opts: { withEdges?: boolean } = {}): number {
  const edges = opts.withEdges === false ? undefined : graph.edges
  const withNode = CreditsService.estimateWorkflowBaseCredits(graph.nodes, edges)
  const withoutNode = CreditsService.estimateWorkflowBaseCredits(graph.nodes.filter((n) => n.id !== "ac1"), edges)
  return withNode - withoutNode
}

/** The credit id that quote corresponds to (the two rows differ — asserted below). */
function estimatedCaptionId(graph: Graph, opts: { withEdges?: boolean } = {}): string {
  const credits = estimatedCaptionCredits(graph, opts)
  const match = [STATIC_ID, KINETIC_ID].filter((id) => STATIC_CREDIT_COSTS[id] === credits)
  expect(match, `quote ${credits} matches exactly one add-captions row`).toHaveLength(1)
  return match[0]
}

/** The credit id the RUN reserves: real input resolution → real payload build. */
function reservedCaptionId(graph: Graph): string {
  const ac = graph.nodes.find((n) => n.id === "ac1")!
  const inputs = resolveNodeInputs(ac, graph.edges, graph.states ?? {}, graph.nodes)
  return buildPayload(ac, "job-1", inputs, "usage-1").modelIdentifier ?? ""
}

/** The whole contract in one call: the two ids, and the never-under-quote rule. */
function agreement(graph: Graph, opts: { withEdges?: boolean } = {}): { estimated: string; reserved: string } {
  const estimated = estimatedCaptionId(graph, opts)
  const reserved = reservedCaptionId(graph)
  expect(
    STATIC_CREDIT_COSTS[estimated],
    `estimate (${estimated}) must never be below the reservation (${reserved})`,
  ).toBeGreaterThanOrEqual(STATIC_CREDIT_COSTS[reserved])
  return { estimated, reserved }
}

/** A completed transcribe node: `json` for the transcript handle, `text` +
 *  `captions` for the default (text-source) handle — the shape
 *  output-extractor/input-resolver read. */
function transcribeState(): NodeExecutionState {
  return {
    status: "completed",
    output: {
      json: TRANSCRIPT,
      text: "Hello",
      captions: [{ text: "Hello", startMs: 0, endMs: 500 }],
    } as NodeExecutionState["output"],
    completedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("add-captions: the workflow estimate agrees with what the run reserves", () => {
  it("prices the two renderers differently (the premise every case below rests on)", () => {
    expect(STATIC_CREDIT_COSTS[STATIC_ID]).toBeGreaterThan(0)
    expect(STATIC_CREDIT_COSTS[KINETIC_ID]).toBeGreaterThan(STATIC_CREDIT_COSTS[STATIC_ID])
  })

  it("literal text, nothing wired — BOTH take the cheap FFmpeg burn", () => {
    const graph: Graph = { nodes: [captionsNode({ style: "subtitle", text: "Hello" })], edges: [] }
    const { estimated, reserved } = agreement(graph)
    expect(estimated).toBe(STATIC_ID)
    expect(reserved).toBe(STATIC_ID)
  })

  it("a `{Label}` text OVER-quotes rather than risking the cheap lane", () => {
    // A reference can resolve to nothing at run time, which flips the render to
    // transcription → Remotion. The estimate cannot know, so it quotes the
    // render; this run's ref resolves to itself (no ref map), so the
    // reservation is the burn. Over-quote by design — never the reverse.
    const graph: Graph = { nodes: [captionsNode({ style: "subtitle", text: "{Intro}" })], edges: [] }
    const { estimated, reserved } = agreement(graph)
    expect(estimated).toBe(KINETIC_ID)
    expect(reserved).toBe(STATIC_ID)
  })

  it("a transcribe wired into the `transcript` handle beats an inline literal text — BOTH kinetic", () => {
    // The under-quote F9 reported: node data says "Hello" (cheap), but the edge
    // delivers a transcript, and the run reserves the render.
    const graph: Graph = {
      nodes: [node("tr1", "transcribe", { provider: "elevenlabs-stt" }), captionsNode({ style: "subtitle", text: "Hello" })],
      edges: [edge("tr1", "ac1", "json", "transcript")],
      states: { tr1: transcribeState() },
    }
    const { estimated, reserved } = agreement(graph)
    expect(estimated).toBe(KINETIC_ID)
    expect(reserved).toBe(KINETIC_ID)
  })

  it("an apply-edl transcript on the `transcript` handle — BOTH kinetic", () => {
    // Same graph fact from a different producer: the estimator keys on the
    // HANDLE, not on the source node's type, so a remapped Transcript counts.
    const graph: Graph = {
      nodes: [node("edl1", "apply-edl", {}), captionsNode({ style: "subtitle", text: "Hello" })],
      edges: [edge("edl1", "ac1", "json", "transcript")],
      states: {
        edl1: {
          status: "completed",
          output: { json: TRANSCRIPT, videoUrl: VIDEO_URL } as NodeExecutionState["output"],
          completedAt: new Date().toISOString(),
        },
      },
    }
    const { estimated, reserved } = agreement(graph)
    expect(estimated).toBe(KINETIC_ID)
    expect(reserved).toBe(KINETIC_ID)
  })

  it("a transcribe wired as a TEXT source (default handle) — BOTH kinetic", () => {
    // No `transcript` handle here: the resolver hands the node word-timed
    // `captions` alongside the text, which is a Remotion render. The estimator
    // sees it because the edge's SOURCE is a transcribe node — the inline
    // literal text below would otherwise make it quote the burn.
    const graph: Graph = {
      nodes: [node("tr1", "transcribe", { provider: "elevenlabs-stt" }), captionsNode({ style: "subtitle", text: "Hello" })],
      edges: [edge("tr1", "ac1")],
      states: { tr1: transcribeState() },
    }
    const { estimated, reserved } = agreement(graph)
    expect(estimated).toBe(KINETIC_ID)
    expect(reserved).toBe(KINETIC_ID)
  })

  it("a TEXT node wired in over-quotes — the estimate cannot see an upstream caption text", () => {
    // The node carries no `text` of its own, so before the run the only caption
    // source the estimator can name is transcription (a render). The resolver
    // then delivers the upstream text and the run burns it with drawtext. Over-
    // quote, which is the allowed direction.
    const graph: Graph = {
      nodes: [node("tx1", "text-prompt", { text: "Hello from upstream" }), captionsNode({ style: "subtitle" })],
      edges: [edge("tx1", "ac1")],
      states: {
        tx1: { status: "completed", output: { text: "Hello from upstream" }, completedAt: new Date().toISOString() },
      },
    }
    const { estimated, reserved } = agreement(graph)
    expect(estimated).toBe(KINETIC_ID)
    expect(reserved).toBe(STATIC_ID)
  })

  it("a styled subtitle — BOTH kinetic (the lever moves the render)", () => {
    const graph: Graph = {
      nodes: [captionsNode({ style: "subtitle", text: "Hello", look: "outline", positionY: 65 })],
      edges: [],
    }
    const { estimated, reserved } = agreement(graph)
    expect(estimated).toBe(KINETIC_ID)
    expect(reserved).toBe(KINETIC_ID)
  })

  it("a segmented subtitle — BOTH kinetic", () => {
    const graph: Graph = {
      nodes: [captionsNode({ style: "subtitle", text: "Hello", segments: [{ startMs: 0, endMs: 2000 }] })],
      edges: [],
    }
    const { estimated, reserved } = agreement(graph)
    expect(estimated).toBe(KINETIC_ID)
    expect(reserved).toBe(KINETIC_ID)
  })

  it("a kinetic style — BOTH kinetic", () => {
    const graph: Graph = { nodes: [captionsNode({ style: "word-highlight", text: "Hello" })], edges: [] }
    const { estimated, reserved } = agreement(graph)
    expect(estimated).toBe(KINETIC_ID)
    expect(reserved).toBe(KINETIC_ID)
  })

  it("NO edges passed — the estimate assumes the pricier lane", () => {
    // A caller with only nodes in hand (POST /v1/credits/estimate-workflow's
    // older body) cannot be told whether a transcript is wired in. Quote the
    // render; the reservation may come in cheaper, never dearer.
    const graph: Graph = { nodes: [captionsNode({ style: "subtitle", text: "Hello" })], edges: [] }
    const { estimated, reserved } = agreement(graph, { withEdges: false })
    expect(estimated).toBe(KINETIC_ID)
    expect(reserved).toBe(STATIC_ID)
  })

  it("edges that touch OTHER nodes leave the cheap quote alone", () => {
    // The over-quote must stay narrow: a video wired into the `in` handle is
    // not a caption source, so a plain-text subtitle keeps the burn price.
    const graph: Graph = {
      nodes: [node("up1", "upload-video", { videoUrl: VIDEO_URL }), captionsNode({ style: "subtitle", text: "Hello" })],
      edges: [edge("up1", "ac1")],
      states: {
        up1: { status: "completed", output: { videoUrl: VIDEO_URL }, completedAt: new Date().toISOString() },
      },
    }
    const { estimated, reserved } = agreement(graph)
    expect(estimated).toBe(STATIC_ID)
    expect(reserved).toBe(STATIC_ID)
  })
})
