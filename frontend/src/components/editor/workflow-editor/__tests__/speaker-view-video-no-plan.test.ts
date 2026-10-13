import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// `priced`: Speaker View; `frames`: Speaker Frames. Video mode is open only with both (R15).
// The real pair today: Speaker View priced, Speaker Frames not.
const flag = vi.hoisted(() => ({ priced: true, frames: false }))
vi.mock("@nodaro/render-rules", async (importOriginal) => (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), flag))
import { SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE } from "@nodaro/render-rules"
import { renderPlanClipKey, renderPlanPath, type RenderGraphEdge } from "@nodaro/shared"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { reviewKindOf, reviewTargetOf } from "@/lib/edl-review/review-entry"
import { finalIsUnchanged, renderRuleVerdict } from "../render-final-checks"
import { renderFinalRunSet } from "../render-final-set"
import { getDownstreamNodeIds } from "../run-from-here-set"
import { browserRenderPlanBasis, currentRenderPlanBasis } from "../apply-edl-stamps"
import { editorPreviewGatedIds, previewRunnable, runPreviewGate } from "../preview-gate"
import { renderOwnRunRefusal } from "../render-review-guards"

/**
 * A Speaker View fed a bare VIDEO has no Edit Plan behind it (decided
 * 2026-10-11). The docs say Preview, the stop rule, Render final, `clipKey` and
 * `planBasis` degrade cleanly with none; these are the cases that hold that
 * line: each answers "nothing to read" / "from the render onward", never throws,
 * and never invents a plan.
 */
const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle?: string) =>
  ({ id: `${source}->${target}`, source, target, ...(targetHandle ? { targetHandle } : {}) }) as unknown as WorkflowEdge

const URL = "https://cdn.example.test/clip.mp4"
const TRANSCRIPT = { words: ["Host", "Host", "Guest", "Guest"].map((speaker, i) => ({ text: `w${i}`, start: i, end: i + 0.5, speaker })) }

function videoFed(quality: "proxy" | "final" = "final") {
  const nodes = [
    node("up", "upload-video", { url: URL, metadata: { width: 3840, height: 2160 } }),
    node("tr", "transcribe", { generatedResults: [{ url: "", transcript: TRANSCRIPT }] }),
    node("sv", "speaker-view", { quality }),
    node("cap", "add-captions"),
  ]
  const edges = [edge("up", "tr"), { ...edge("up", "sv", "video"), sourceHandle: "video" }, { ...edge("tr", "sv", "transcript"), sourceHandle: "transcript" }, edge("sv", "cap")] as WorkflowEdge[]
  return { nodes, edges }
}

const previewRuleOn = () => { window.__NODARO_RUNTIME__ = { previewStopRule: true } }
beforeEach(previewRuleOn)
beforeEach(() => {
  flag.priced = true
  flag.frames = false
})
afterEach(() => { delete window.__NODARO_RUNTIME__ })

describe("a video-fed Speaker View has no plan to read", () => {
  it("renderPlanPath, renderPlanClipKey and both plan bases answer undefined", () => {
    const { nodes, edges } = videoFed()
    const rg = edges as unknown as readonly RenderGraphEdge[]
    expect(renderPlanPath("sv", nodes, rg)).toBeUndefined()
    expect(renderPlanClipKey("sv", nodes, rg, () => undefined, undefined)).toBeUndefined()
    expect(browserRenderPlanBasis("sv", nodes, rg, undefined)).toBeUndefined()
    expect(currentRenderPlanBasis("sv", nodes, rg, undefined)).toBeUndefined()
  })

  it("Review cut has nothing to open", () => {
    const { nodes, edges } = videoFed()
    expect(reviewKindOf("sv", nodes, edges)).toBeNull()
    expect(reviewTargetOf("sv", nodes, edges)).toBeNull()
  })
})

describe("Render final on a video-fed Speaker View", () => {
  it("runs the render and everything after it, exactly Run from here, and re-runs neither Upload nor Transcribe", () => {
    const { nodes, edges } = videoFed()
    const set = renderFinalRunSet("sv", nodes, edges)
    expect([...set].sort()).toEqual(["cap", "sv"])
    expect([...set].sort()).toEqual([...getDownstreamNodeIds("sv", edges)].sort())
  })

  it("the render rule's verdict is a pass for a transcribed, wide-enough video (no edit needed) once video mode is live", () => {
    flag.frames = true
    const { nodes, edges } = videoFed()
    expect(renderRuleVerdict("sv", nodes, edges)).toEqual({ ok: true })
  })

  it("R15: while video mode is not live, the render rule's verdict is the video-mode refusal, as the badge says", () => {
    const { nodes, edges } = videoFed()
    expect(renderRuleVerdict("sv", nodes, edges)).toEqual({ ok: false, issues: [SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE] })
  })

  it("'nothing changed since the last final' fails open and never fetches a job", async () => {
    const { nodes, edges } = videoFed()
    const withTake = nodes.map((n) => (n.id === "sv" ? node("sv", "speaker-view", { generatedResults: [{ url: "f.mp4", jobId: "j1", quality: "final" }] }) : n))
    const getJob = vi.fn().mockResolvedValue({ input_data: { edl: {} } })
    expect(await finalIsUnchanged("sv", withTake, edges, getJob)).toBe(false)
    expect(getJob).not.toHaveBeenCalled()
  })

  it("the render's own run is not refused for want of a reviewed plan", () => {
    const { nodes, edges } = videoFed("proxy")
    expect(renderOwnRunRefusal("sv", nodes, edges)).toBeNull()
  })
})

describe("the stop rule on a video-fed Speaker View", () => {
  it("a Preview Speaker View stops what follows it, exactly as any Preview render does", () => {
    const { nodes, edges } = videoFed("proxy")
    expect(previewRunnable(nodes, nodes, edges).map((n) => n.id)).toEqual(["up", "tr", "sv"])
    expect([...editorPreviewGatedIds(nodes, edges)]).toEqual(["cap"])
  })

  it("a Final Speaker View stops nothing", () => {
    const { nodes, edges } = videoFed("final")
    expect(previewRunnable(nodes, nodes, edges)).toHaveLength(4)
    expect(editorPreviewGatedIds(nodes, edges).size).toBe(0)
  })

  it("a run on show that holds a Preview take offers Render final and holds the tail back", () => {
    const { nodes, edges } = videoFed("proxy")
    const gate = runPreviewGate(nodes, edges, {
      up: { status: "completed" },
      tr: { status: "completed" },
      sv: { status: "completed", output: { quality: "proxy", videoUrl: "p.mp4" } },
    })
    expect([...gate.previewRenderIds]).toEqual(["sv"])
    expect([...gate.gatedNodeIds]).toEqual(["cap"])
  })
})
