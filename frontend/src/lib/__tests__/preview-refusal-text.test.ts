/**
 * The editor's preview refusals name the remedy for what holds the run: a
 * render at Preview is set to Final; a review-on Tighten Episode node has its
 * "Review before render" turned off (a Final does nothing to it). Both, when
 * both hold it or nothing says which. The render texts are unchanged, and the
 * English copy is the server's word for word.
 */
import { afterEach, beforeEach, describe, it, expect } from "vitest"
import { previewRenderPreflight, triggerBranchPreviewKind } from "@/components/editor/workflow-editor/preview-gate"
import { tx } from "@/lib/i18n"
import { nodeErrorCodeText, nodeStateErrorText } from "../execution-error-text"
import { previewRefusalText, type PreviewRefusalSituation } from "../preview-refusal-text"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

beforeEach(() => { window.__NODARO_RUNTIME__ = { previewStopRule: true } })
afterEach(() => { delete window.__NODARO_RUNTIME__ })

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data, position: { x: 0, y: 0 } }) as unknown as WorkflowNode
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target }) as WorkflowEdge
const SITUATIONS: PreviewRefusalSituation[] = ["headless", "nested", "trigger"]

describe("the copy by what holds the run", () => {
  it("the render texts are the ones the editor has always shown", () => {
    expect(previewRefusalText("headless", "render")).toBe(
      "This workflow stops for a review: its render is set to Preview, and only a run started in the Nodaro editor or on an app's own page can stop for one. Open it there to run it, or set the render to Final (or send a Final quality override for it).",
    )
    expect(previewRefusalText("nested", "render")).toBe("This sub-workflow stops for a review (its render is set to Preview), and a nested workflow cannot. Set that render to Final.")
    expect(previewRefusalText("trigger", "render")).toBe("Runs from this trigger are refused: its branch stops for a review (a render is set to Preview). Set the render to Final.")
  })

  it.each(SITUATIONS)("%s: a review-on node is told to turn its review off, never to set a Final; both name both", (situation) => {
    const review = previewRefusalText(situation, "review")
    expect(review).toMatch(/“Review before render”/)
    expect(review).toMatch(/Tighten Episode/)
    expect(review).not.toMatch(/Final/)
    const any = previewRefusalText(situation, "any")
    expect(any).toMatch(/“Review before render”/)
    expect(any).toMatch(/Final/)
    // No kind known: the render's words, as always.
    expect(previewRefusalText(situation)).toBe(previewRefusalText(situation, "render"))
  })
})

describe("the editor's refusals read the graph", () => {
  const rec = node("rec", "upload-video", { url: "https://r2/ep.mp4" })
  const t1 = node("t1", "tighten-episode", { reviewBeforeRender: true })
  const cut = node("cut", "apply-edl", { quality: "proxy" })
  const out = node("out", "sub-workflow-output")

  it("a nested review-on Tighten Episode: the nested refusal names its review", () => {
    expect(previewRenderPreflight([rec, t1, out], [edge("rec", "t1"), edge("t1", "out")])).toBe(tx("previewGate.nestedRefusalReview"))
  })

  it("a nested render at Preview: the render's words", () => {
    expect(previewRenderPreflight([cut, out], [edge("cut", "out")])).toBe(tx("previewGate.nestedRefusalRender"))
  })

  it("both in one nested graph: both remedies", () => {
    const out2 = node("out2", "sub-workflow-output")
    expect(previewRenderPreflight([rec, t1, cut, out, out2], [edge("rec", "t1"), edge("t1", "out"), edge("cut", "out2")])).toBe(tx("previewGate.nestedRefusal"))
  })

  it("an armed trigger's branch: what holds it", () => {
    const trig = node("trig", "schedule-trigger")
    expect(triggerBranchPreviewKind("trig", [trig, t1, out], [edge("trig", "t1"), edge("t1", "out")])).toBe("review")
    expect(triggerBranchPreviewKind("trig", [trig, cut, out], [edge("trig", "cut"), edge("cut", "out")])).toBe("render")
    expect(triggerBranchPreviewKind("trig", [trig, node("t2", "tighten-episode"), out], [edge("trig", "t2"), edge("t2", "out")])).toBeNull()
  })
})

describe("a node's preview refusal", () => {
  it("on a Tighten Episode node: its own review", () => {
    expect(nodeErrorCodeText("preview_review_required", "tighten-episode")).toBe(previewRefusalText("headless", "review"))
    expect(nodeStateErrorText({ error: "sent", errorCode: "preview_review_required" }, "tighten-episode")).toBe(previewRefusalText("headless", "review"))
  })

  it("on any other node: the server's text is kept (it already names what held it)", () => {
    expect(nodeErrorCodeText("preview_render_nested", "sub-workflow")).toBeNull()
    expect(nodeStateErrorText({ error: "server words", errorCode: "preview_render_nested" }, "sub-workflow")).toBe("server words")
  })
})
