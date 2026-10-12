import { beforeEach, describe, it, expect, vi } from "vitest"
import type { WorkflowNode } from "@/types/nodes"

vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))
// The gate is tested with the price withdrawn; priced (the shipped state) is the last case.
const pricing = vi.hoisted(() => ({ priced: false, frames: true }))
vi.mock("@nodaro/render-rules", async (importOriginal) => (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), pricing))

const { speakerViewPricePreflight, speakerViewVideoPreflight } = await import("../speaker-view-price-preflight")
const { nestedRunPreflight } = await import("../sub-workflow-preflight")

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode

describe("speakerViewPricePreflight", () => {
  it("names the first Speaker View node the run executes", () => {
    const msg = speakerViewPricePreflight([node("t", "transcribe"), node("Speakers", "speaker-view")])
    expect(msg).toContain("Speakers")
    expect(msg).toContain("Speaker View is not priced yet")
  })

  it("lets a run with no Speaker View start, and ignores a skipped one", () => {
    expect(speakerViewPricePreflight([node("t", "transcribe")])).toBeNull()
    expect(speakerViewPricePreflight([node("sv", "speaker-view", { skipped: true })])).toBeNull()
  })

  it("is part of the nested walk: a Speaker View inside a referenced workflow refuses the run up front", async () => {
    const sub = node("s1", "sub-workflow", {
      referencedWorkflowId: "wf-a",
      selectedRouteId: "r1",
      routeSnapshot: { inputPorts: [], outputPorts: [], visibleOutputPortId: "out" },
    })
    const msg = await nestedRunPreflight([sub], {
      load: async () => ({
        nodes: [node("Inner Speakers", "speaker-view")],
        edges: [],
        inputNode: node("in", "sub-workflow-input"),
        outputNode: node("out", "sub-workflow-output"),
      }),
    })
    expect(msg).toContain("Inner Speakers")
    expect(msg).toContain("Speaker View is not priced yet")
  })

  it("lets every run start once Speaker View is priced (C4)", () => {
    pricing.priced = true
    try {
      expect(speakerViewPricePreflight([node("t", "transcribe"), node("Speakers", "speaker-view")])).toBeNull()
    } finally {
      pricing.priced = false
    }
  })
})

describe("speakerViewVideoPreflight", () => {
  const edge = (source: string, target: string, targetHandle: string) => ({ id: `${source}-${targetHandle}`, source, target, targetHandle }) as never
  const graph = (over: { transcript?: boolean; edl?: boolean; meta?: Record<string, unknown> } = {}) => ({
    nodes: [
      node("up", "upload-video", { metadata: over.meta ?? { width: 3840, height: 2160 } }),
      node("tx", "transcribe"),
      node("plan", "edit-plan"),
      node("sv", "speaker-view"),
    ],
    edges: [
      edge("up", "sv", "video"),
      ...(over.transcript === false ? [] : [edge("tx", "sv", "transcript")]),
      ...(over.edl ? [edge("plan", "sv", "edl")] : []),
    ],
  })

  // The rules below the video-mode gate run with the mode open (R15).
  beforeEach(() => {
    pricing.priced = true
    pricing.frames = true
  })

  it("R15: refuses video mode while Speaker View or Speaker Frames is unpriced, before anything charges", () => {
    for (const [priced, frames] of [[true, false], [false, true], [false, false]] as const) {
      pricing.priced = priced
      pricing.frames = frames
      const g = graph()
      const msg = speakerViewVideoPreflight(g.nodes, g.nodes, g.edges)
      expect(msg, `${priced}/${frames}`).toContain("Speaker View from a video is not available yet")
      expect(msg).toContain("nothing was charged")
      // An edit-driven Speaker View is not behind the video gate.
      const edit = graph({ edl: true })
      expect(speakerViewVideoPreflight(edit.nodes, edit.nodes, edit.edges.filter((e: { targetHandle?: string }) => e.targetHandle !== "video"))).toBeNull()
    }
  })

  it("lets a wired video with a transcript start", () => {
    const g = graph()
    expect(speakerViewVideoPreflight(g.nodes, g.nodes, g.edges)).toBeNull()
  })

  it("refuses, before anything charges, a video with no transcript, an edit beside it, or a source too narrow", () => {
    for (const [over, expected] of [
      [{ transcript: false }, /Transcribe/],
      [{ edl: true }, /not both/i],
      [{ meta: { width: 1080, height: 1920 } }, /1080×1920/],
    ] as const) {
      const g = graph(over)
      const msg = speakerViewVideoPreflight(g.nodes, g.nodes, g.edges)
      expect(msg).toMatch(expected)
      expect(msg).toContain("nothing was charged")
    }
  })

  it("ignores a Speaker View the run does not execute", () => {
    const g = graph({ transcript: false })
    expect(speakerViewVideoPreflight([g.nodes[0]!], g.nodes, g.edges)).toBeNull()
  })
})
