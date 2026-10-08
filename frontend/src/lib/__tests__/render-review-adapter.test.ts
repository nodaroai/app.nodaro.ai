/**
 * Review on every render node (C3.4, SV18): one adapter per registry id, and
 * each answers with the render's OWN rule, basis, refusal and clock — Speaker
 * View is never judged, stamped or mapped as Apply EDL.
 */
import { describe, it, expect } from "vitest"
import { RENDER_NODE_TYPE_IDS, normalizeEdl } from "@nodaro/shared"
import { SPEAKER_VIEW_PRICED, findSpeakerViewIssues, speakerViewContext, speakerViewRenderBasis, speakerViewWireSettings } from "@nodaro/render-rules"
import {
  RENDER_REVIEW_ADAPTERS,
  renderReviewAdapterOf,
  renderRowsOf,
  renderRunRefusalKey,
  renderSettingsBasisFor,
  takeClockMap,
} from "../render-review-adapter"
import { clockMapOf } from "../edl-review/review-clock"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const MIC = { id: "mic", url: "https://x/mic.wav", kind: "audio", role: "master-audio" }
const src = (id: string) => ({ id, url: `https://x/${id}.mp4`, kind: "video" })
const seg = (id: string, inS: number, video: string, speaker?: string, extra: Record<string, unknown> = {}) =>
  ({ id, inMs: inS * 1000, outMs: (inS + 5) * 1000, video, ...(speaker ? { speaker } : {}), ...extra })
const edl = (segments: unknown[]) => ({ version: 1, clock: "master", sources: [MIC, src("a"), src("b")], segments })
/** A named two-camera edit that Speaker View draws side by side: Apply EDL refuses its layout. */
const HINTED = edl([
  seg("s0", 0, "a", "Host"),
  seg("s1", 5, "b", "Guest", { layout: { mode: "side-by-side", slots: [{ source: "a", speaker: "Host" }, { source: "b", speaker: "Guest" }] } }),
])

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode
const wire = (source: string, target: string, targetHandle: string) =>
  ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle: "json", targetHandle }) as unknown as WorkflowEdge
const graph = (type: "apply-edl" | "speaker-view", edit: unknown, data: Record<string, unknown> = {}) => {
  const nodes = [node("plan", "edit-plan", { generatedJson: edit }), node("r", type, data)]
  return { nodes, edges: [wire("plan", "r", "edl")], render: nodes[1]! }
}

describe("RENDER_REVIEW_ADAPTERS", () => {
  it("has an adapter for every render node type the registry lists, and none for anything else", () => {
    expect(Object.keys(RENDER_REVIEW_ADAPTERS).sort()).toEqual([...RENDER_NODE_TYPE_IDS].sort())
    for (const type of RENDER_NODE_TYPE_IDS) expect(renderReviewAdapterOf(type)).toBeDefined()
    expect(renderReviewAdapterOf("edit-plan")).toBeUndefined()
    expect(renderReviewAdapterOf("constructor")).toBeUndefined()
    expect(renderReviewAdapterOf(undefined)).toBeUndefined()
  })
})

describe("the render's own rule", () => {
  it("judges Speaker View by its rule: a hinted layout Apply EDL refuses is ready to render", () => {
    const sv = graph("speaker-view", HINTED)
    const svVerdict = RENDER_REVIEW_ADAPTERS["speaker-view"]!.validity(renderRowsOf(sv.render, sv.nodes, sv.edges), {})
    expect(svVerdict).toMatchObject({ ok: true })

    const ae = graph("apply-edl", HINTED)
    const aeVerdict = RENDER_REVIEW_ADAPTERS["apply-edl"]!.validity(renderRowsOf(ae.render, ae.nodes, ae.edges), {})
    expect(aeVerdict?.ok).toBe(false)
    expect(aeVerdict?.issues.join("\n")).toMatch(/speaker-view/)
  })

  it("refuses for Speaker View what the plugin refuses (no speaker on a multicam edit)", () => {
    const sv = graph("speaker-view", edl([seg("s0", 0, "a"), seg("s1", 5, "b")]))
    const verdict = RENDER_REVIEW_ADAPTERS["speaker-view"]!.validity(renderRowsOf(sv.render, sv.nodes, sv.edges), {})
    expect(verdict?.ok).toBe(false)
    expect(verdict?.issues[0]).toMatch(/Wire Camera Switch/)
  })

  it("reads Speaker View's transcript on its row", () => {
    const unnamed = edl([seg("s0", 0, "a"), seg("s1", 5, "b")])
    const transcript = { words: [{ text: "x", startMs: 0, endMs: 1, speaker: "speaker_0" }] }
    const nodes = [node("plan", "edit-plan", { generatedJson: unnamed }), node("tx", "transcribe", { generatedJson: JSON.stringify(transcript) }), node("r", "speaker-view")]
    const edges = [wire("plan", "r", "edl"), wire("tx", "r", "transcript")]
    const rows = renderRowsOf(nodes[2]!, nodes, edges)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.transcript).toBeDefined()
    expect(rows[0]!.sources).toEqual([])
  })
})

describe("the settings basis a take is stamped with", () => {
  it("is Speaker View's own: the basis its run sends (settings normalized against the real edit)", () => {
    const sv = graph("speaker-view", HINTED, { layout: "side-by-side", targetAspect: "9:16" })
    const row = renderRowsOf(sv.render, sv.nodes, sv.edges)[0]
    const settings = speakerViewWireSettings({ layout: "side-by-side", targetAspect: "9:16" }, speakerViewContext(HINTED, undefined))
    const accepted = findSpeakerViewIssues({ edl: HINTED, settings })
    expect(renderSettingsBasisFor(sv.render, row)).toBe(speakerViewRenderBasis(settings, accepted.edl!))
  })

  it("changes with a Speaker View setting, and is unknown for an edit the rule refuses", () => {
    const a = graph("speaker-view", HINTED, { layout: "grid" })
    const b = graph("speaker-view", HINTED, { layout: "single" })
    const basisA = renderSettingsBasisFor(a.render, renderRowsOf(a.render, a.nodes, a.edges)[0])
    const basisB = renderSettingsBasisFor(b.render, renderRowsOf(b.render, b.nodes, b.edges)[0])
    expect(basisA).toBeDefined()
    expect(basisA).not.toBe(basisB)

    const refused = graph("speaker-view", edl([seg("s0", 0, "a"), seg("s1", 5, "b")]))
    expect(renderSettingsBasisFor(refused.render, renderRowsOf(refused.render, refused.nodes, refused.edges)[0])).toBeUndefined()
  })
})

describe("a render that cannot run at all", () => {
  it("is Speaker View while it has no price (C4), and never Apply EDL", () => {
    expect(SPEAKER_VIEW_PRICED).toBe(false)
    expect(renderRunRefusalKey(node("r", "speaker-view"))).toBe("speakerView.notPriced")
    expect(renderRunRefusalKey(node("r", "apply-edl"))).toBeUndefined()
    expect(renderRunRefusalKey(node("r", "edit-plan"))).toBeUndefined()
    expect(renderRunRefusalKey(undefined)).toBeUndefined()
  })

  it("Speaker View's final is never claimed unchanged (its request cannot be compared: TA15 fails open)", () => {
    expect(RENDER_REVIEW_ADAPTERS["speaker-view"]!.sameAsStoredFinal).toBeUndefined()
    expect(RENDER_REVIEW_ADAPTERS["apply-edl"]!.sameAsStoredFinal).toBeDefined()
  })
})

describe("takeClockMap (clockMapFrom)", () => {
  // The EDL Speaker View emitted: its turn split moved s1's start, so its
  // output clock differs from the EDL on its wire.
  const EMITTED = edl([seg("s0", 0, "a", "Host"), { ...seg("s1", 5, "b", "Guest"), inMs: 6000 }])
  const take = (url: string) => ({ url, medium: "video" as const, quality: "proxy" as const })
  const context = { output: "video" as const, crossfadeMs: 0, sources: [] as string[] }
  const svData = (extra: Record<string, unknown> = {}) => ({
    generatedResults: [{ url: "new.mp4" }, { url: "old.mp4" }],
    generatedVideoUrl: "new.mp4",
    generatedJson: JSON.stringify(EMITTED),
    ...extra,
  })

  it("maps Speaker View's newest take through the EDL it emitted — not the EDL on its wire — even behind Camera Switch", () => {
    const map = takeClockMap({ type: "speaker-view", renderData: svData(), take: take("new.mp4"), row: { edl: HINTED, sources: [] }, context, passesOtherNodes: true })
    expect(map).toEqual(normalizeEdl(EMITTED))
  })

  it("has no map for an older Speaker View take, or with no emitted json", () => {
    expect(takeClockMap({ type: "speaker-view", renderData: svData(), take: take("old.mp4"), row: undefined, context, passesOtherNodes: false })).toBeNull()
    expect(takeClockMap({ type: "speaker-view", renderData: svData({ generatedJson: undefined }), take: take("new.mp4"), row: undefined, context, passesOtherNodes: false })).toBeNull()
    expect(takeClockMap({ type: "speaker-view", renderData: svData({ generatedJson: "[1]" }), take: take("new.mp4"), row: undefined, context, passesOtherNodes: false })).toBeNull()
  })

  it("maps Apply EDL through the EDL on its wire, and holds none behind Camera Switch", () => {
    const row = { edl: EMITTED, sources: [] }
    expect(takeClockMap({ type: "apply-edl", renderData: {}, take: take("x.mp4"), row, context, passesOtherNodes: false })).toEqual(clockMapOf(EMITTED, context))
    expect(takeClockMap({ type: "apply-edl", renderData: {}, take: take("x.mp4"), row, context, passesOtherNodes: true })).toBeNull()
  })
})
