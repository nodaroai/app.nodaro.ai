// @vitest-environment node
/**
 * Every source of a video-fed Speaker View is checked before anything charges
 * (decided 2026-10-12, R5), in the EDITOR's engine as well as the server's.
 *
 * Two questions, one rule (`@nodaro/render-rules`):
 *   - at run start, a source that already exists (an Upload, a result saved on a
 *     node the run does not execute) is measured through the cached background
 *     job and refused for free;
 *   - a source the run produces is awaited by every paid node that feeds the
 *     Speaker View, and measured the moment it exists, before the first of them
 *     dispatches.
 */
import { describe, it, expect, vi } from "vitest"
import { ClipMeasureStopped } from "@/lib/clip-measure-poll"
import { speakerViewDispatchGate, speakerViewRunStartSourceCheck, memoizedMeasure } from "../speaker-view-source"

type N = { id: string; type: string; data: Record<string, unknown> }
type E = { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }

const node = (id: string, type: string, data: Record<string, unknown> = {}): N => ({ id, type, data: { label: id, ...data } })
const wire = (source: string, target: string, targetHandle: string): E => ({ id: `${source}-${target}-${targetHandle}`, source, target, targetHandle })

const URL = "https://cdn.example.test/uploads/a.mp4"
const NARROW = { durationMs: 5_000, width: 1080, height: 1920 }
const WIDE = { durationMs: 5_000, width: 3840, height: 2160 }

/** upload -> sv(video), tx -> sv(transcript); tx is fed by the same upload (audio). */
function uploadGraph(svData: Record<string, unknown> = { label: "Vertical cut" }) {
  const nodes = [node("up", "upload-video", { url: URL }), node("tx", "transcribe"), node("sv", "speaker-view", svData)]
  const edges = [wire("up", "tx", "audio"), wire("up", "sv", "video"), wire("tx", "sv", "transcript")]
  return { nodes, edges }
}
const urlOfUpload = (id: string) => (id === "sv" ? URL : undefined)

describe("speakerViewRunStartSourceCheck", () => {
  it("refuses a URL-only upload (no saved size) that measures as narrow as the target, naming the node by its label", async () => {
    const { nodes, edges } = uploadGraph()
    const measure = vi.fn(async () => NARROW)
    const message = await speakerViewRunStartSourceCheck({ executing: [nodes[1]!, nodes[2]!], nodes, edges, urlOf: urlOfUpload, measure, videoModeLive: true })
    expect(message).toMatch(/1080×1920/)
    expect(message).toContain('Speaker View node "Vertical cut"')
    expect(message).toContain("nothing was charged")
    expect(message).not.toMatch(/\bsv\b/)
    expect(measure).toHaveBeenCalledWith(URL)
  })

  it("passes a wide source, with one measurement per address even for two views on it", async () => {
    const { nodes, edges } = uploadGraph()
    nodes.push(node("sv2", "speaker-view", { label: "Square cut", targetAspect: "1:1" }))
    edges.push(wire("up", "sv2", "video"), wire("tx", "sv2", "transcript"))
    const measure = vi.fn(async () => WIDE)
    const message = await speakerViewRunStartSourceCheck({ executing: nodes.slice(1), nodes, edges, urlOf: () => URL, measure, videoModeLive: true })
    expect(message).toBeNull()
    expect(measure).toHaveBeenCalledTimes(1)
  })

  it("does not look at a source the run itself produces (the feeders' gate does, once it exists)", async () => {
    const nodes = [node("gv", "generate-video", { generatedVideoUrl: URL }), node("tx", "transcribe"), node("sv", "speaker-view")]
    const edges = [wire("gv", "sv", "video"), wire("tx", "sv", "transcript"), wire("gv", "tx", "audio")]
    const measure = vi.fn(async () => NARROW)
    expect(await speakerViewRunStartSourceCheck({ executing: nodes, nodes, edges, urlOf: () => URL, measure, videoModeLive: true })).toBeNull()
    expect(measure).not.toHaveBeenCalled()
  })

  it("judges only a Speaker View the run executes", async () => {
    const { nodes, edges } = uploadGraph()
    const measure = vi.fn(async () => NARROW)
    expect(await speakerViewRunStartSourceCheck({ executing: [nodes[1]!], nodes, edges, urlOf: urlOfUpload, measure, videoModeLive: true })).toBeNull()
    expect(measure).not.toHaveBeenCalled()
  })

  it("skips a source with no address yet", async () => {
    const { nodes, edges } = uploadGraph()
    const measure = vi.fn(async () => NARROW)
    expect(await speakerViewRunStartSourceCheck({ executing: nodes.slice(1), nodes, edges, urlOf: () => undefined, measure, videoModeLive: true })).toBeNull()
    expect(measure).not.toHaveBeenCalled()
  })

  it("reports a clip that cannot be measured in the server's words, naming the node", async () => {
    const { nodes, edges } = uploadGraph()
    const measure = vi.fn(async (): Promise<typeof WIDE> => { throw new Error("This file has no picture.") })
    const message = await speakerViewRunStartSourceCheck({ executing: nodes.slice(1), nodes, edges, urlOf: urlOfUpload, measure, videoModeLive: true })
    expect(message).toContain("This file has no picture.")
    expect(message).toContain('Speaker View node "Vertical cut"')
  })

  it("R2: a node that opts in refuses a clip with no faces; one that does not renders it", async () => {
    const withFaces = uploadGraph({ label: "Vertical cut", requireFaces: true })
    const measure = vi.fn(async () => ({ ...WIDE, faces: "none" as const }))
    expect(await speakerViewRunStartSourceCheck({ executing: withFaces.nodes.slice(1), nodes: withFaces.nodes, edges: withFaces.edges, urlOf: urlOfUpload, measure, videoModeLive: true })).toMatch(/no faces/i)
    const without = uploadGraph()
    expect(await speakerViewRunStartSourceCheck({ executing: without.nodes.slice(1), nodes: without.nodes, edges: without.edges, urlOf: urlOfUpload, measure, videoModeLive: true })).toBeNull()
  })

  it("lets a Stop or a restarted run through as itself, never as a refusal", async () => {
    const { nodes, edges } = uploadGraph()
    const measure = vi.fn(async (): Promise<typeof WIDE> => { throw new ClipMeasureStopped("stale") })
    await expect(speakerViewRunStartSourceCheck({ executing: nodes.slice(1), nodes, edges, urlOf: urlOfUpload, measure, videoModeLive: true })).rejects.toBeInstanceOf(ClipMeasureStopped)
  })
})

describe("speakerViewDispatchGate", () => {
  /** gv -> tx (audio), gv -> sv (video), tx -> sv (transcript): Generate Video is the source the run produces. */
  function inRun() {
    const nodes = [node("gv", "generate-video"), node("tx", "transcribe"), node("sv", "speaker-view", { label: "Vertical cut" })]
    const edges = [wire("gv", "tx", "audio"), wire("gv", "sv", "video"), wire("tx", "sv", "transcript")]
    return { nodes, edges }
  }
  const gate = (target: N, nodes: N[], edges: E[], over: { ready?: (id: string) => boolean; url?: string; measure?: (u: string) => Promise<typeof WIDE> } = {}) =>
    speakerViewDispatchGate({
      node: target,
      nodes,
      edges,
      sourceReady: over.ready ?? (() => true),
      urlOf: () => over.url ?? URL,
      measure: over.measure ?? (async () => NARROW),
      videoModeLive: true,
    })

  it("refuses a paid feeder once the source exists and measures narrow, before it charges", async () => {
    const { nodes, edges } = inRun()
    const err = await gate(nodes[1]!, nodes, edges).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/1080×1920/)
    expect((err as Error).message).toContain('Speaker View node "Vertical cut"')
    expect((err as Error).message).toMatch(/Nothing that feeds it was run or charged/)
  })

  it("lets a feeder run when the source is wide", async () => {
    const { nodes, edges } = inRun()
    await expect(gate(nodes[1]!, nodes, edges, { measure: async () => WIDE })).resolves.toBeUndefined()
  })

  it("never judges the source itself, a node upstream of it, or the Speaker View (its own dispatch does)", async () => {
    const { nodes, edges } = inRun()
    nodes.unshift(node("pr", "generate-text"))
    edges.push(wire("pr", "gv", "prompt"))
    const measure = vi.fn(async () => NARROW)
    for (const id of ["gv", "pr", "sv"]) {
      await expect(gate(nodes.find((n) => n.id === id)!, nodes, edges, { measure })).resolves.toBeUndefined()
    }
    expect(measure).not.toHaveBeenCalled()
  })

  it("cannot look at a source that has not produced anything yet", async () => {
    const { nodes, edges } = inRun()
    const measure = vi.fn(async () => NARROW)
    await expect(gate(nodes[1]!, nodes, edges, { ready: () => false, measure })).resolves.toBeUndefined()
    expect(measure).not.toHaveBeenCalled()
  })

  it("shares one measurement across the feeders of a run when the caller memoises", async () => {
    const { nodes, edges } = inRun()
    nodes.push(node("ex", "extract-audio"))
    edges.push(wire("gv", "ex", "video"), wire("ex", "tx", "audio2"))
    const raw = vi.fn(async () => WIDE)
    const measure = memoizedMeasure(raw)
    await speakerViewDispatchGate({ node: nodes[1]!, nodes, edges, sourceReady: () => true, urlOf: () => URL, measure, videoModeLive: true })
    await speakerViewDispatchGate({ node: nodes[3]!, nodes, edges, sourceReady: () => true, urlOf: () => URL, measure, videoModeLive: true })
    expect(raw).toHaveBeenCalledTimes(1)
  })

  it("is not asked about a graph with no video-fed Speaker View", async () => {
    const nodes = [node("tx", "transcribe"), node("sv", "speaker-view")]
    const measure = vi.fn(async () => NARROW)
    await expect(gate(nodes[0]!, nodes, [wire("tx", "sv", "transcript")], { measure })).resolves.toBeUndefined()
    expect(measure).not.toHaveBeenCalled()
  })
})
