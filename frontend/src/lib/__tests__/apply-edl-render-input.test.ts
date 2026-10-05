import { describe, it, expect } from "vitest"
import {
  applyEdlRenderContext,
  resolveApplyEdlRenderEdl,
  resolveApplyEdlRenderSources,
} from "../apply-edl-render-input"

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data })
const edge = (source: string, target: string, targetHandle: string | null, sourceHandle?: string) => ({
  source,
  target,
  targetHandle,
  ...(sourceHandle ? { sourceHandle } : {}),
})
const seg = (inMs: number, outMs: number) => ({ id: `s${inMs}`, inMs, outMs, video: "v" })
const edlOf = (...segments: Array<Record<string, unknown>>) => ({
  version: 1, clock: "master", sources: [{ id: "v", url: "https://cdn/v.mp4", kind: "video" }], segments,
})

// The Apply EDL panel badge judges the EDL the node would render now, picked the
// way both engines pick it (#1789 built this selection; A2b brings it back).
describe("resolveApplyEdlRenderEdl", () => {
  const planA = edlOf(seg(0, 60_000))
  const planB = edlOf(seg(0, 120_000))

  it("nothing wired: the inline EDL", () => {
    const ae = node("ae", "apply-edl", { edl: planA })
    expect(resolveApplyEdlRenderEdl(ae, [ae], [])).toEqual({ value: planA, source: "inline" })
  })

  it("wired: what the wire delivers, read through a teleport", () => {
    const plan = node("p", "edit-plan", { generatedJson: planA })
    const send = node("ts", "teleport-send")
    const recv = node("tr", "teleport-receive")
    const ae = node("ae", "apply-edl", { edl: planB })
    const nodes = [plan, send, recv, ae]
    const edges = [edge("p", "ts", "in"), edge("ts", "tr", "in"), edge("tr", "ae", "edl")]
    expect(resolveApplyEdlRenderEdl(ae, nodes, edges)).toEqual({ value: JSON.stringify(planA), source: "wire" })
  })

  it("two wires: the LAST one, as both engines keep the last value", () => {
    const p1 = node("p1", "edit-plan", { generatedJson: planA })
    const p2 = node("p2", "edit-plan", { generatedJson: planB })
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenderEdl(ae, [p1, p2, ae], [edge("p1", "ae", "edl"), edge("p2", "ae", "edl")]).value).toBe(JSON.stringify(planB))
  })

  // The engines skip a wire whose producer yields nothing (`if (!output)
  // continue`), then render `inputs.edl ?? data.edl`.
  it("the last wire whose producer holds a plan — an empty last wire is skipped", () => {
    const p1 = node("p1", "edit-plan", { generatedJson: planA })
    const p2 = node("p2", "edit-plan") // not run yet
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenderEdl(ae, [p1, p2, ae], [edge("p1", "ae", "edl"), edge("p2", "ae", "edl")])).toEqual({ value: JSON.stringify(planA), source: "wire" })
  })

  it("every wire empty: the inline EDL renders", () => {
    const plan = node("p", "edit-plan", { generatedJson: [] })
    const ae = node("ae", "apply-edl", { edl: planA })
    expect(resolveApplyEdlRenderEdl(ae, [plan, ae], [edge("p", "ae", "edl")])).toEqual({ value: planA, source: "inline" })
  })

  it("a clips plan stays the clip list, one render per clip", () => {
    const plan = node("p", "edit-plan", { generatedJson: [planA, planB] })
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenderEdl(ae, [plan, ae], [edge("p", "ae", "edl")])).toEqual({
      value: [JSON.stringify(planA), JSON.stringify(planB)],
      source: "plan",
    })
  })

  // A plan of one clip renders once, that clip, as both engines read it.
  it("a clips plan of one clip: that clip, one render", () => {
    const plan = node("p", "edit-plan", { generatedJson: [planA] })
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenderEdl(ae, [plan, ae], [edge("p", "ae", "edl")])).toEqual({ value: JSON.stringify(planA), source: "wire" })
  })

  it("Camera Switch: its switched EDL, or the whole per-clip batch (JSON strings, as every lane stores it)", () => {
    const one = node("cs", "camera-switch", { generatedJson: { edl: planA, transcript: {} } })
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenderEdl(ae, [one, ae], [edge("cs", "ae", "edl")]).value).toBe(JSON.stringify(planA))
    const batch = [JSON.stringify(planA), JSON.stringify(planB)]
    const many = node("cs", "camera-switch", { generatedJson: { edl: planB, transcript: {} }, __listResults: batch })
    expect(resolveApplyEdlRenderEdl(ae, [many, ae], [edge("cs", "ae", "edl")])).toEqual({ value: batch, source: "plan" })
  })

  // Both engines read Camera Switch's Transcript output as one value, whatever
  // its batch holds: wired into the EDL input, the transcript is what renders.
  it("Camera Switch's transcript wire: the transcript, never the switched plan", () => {
    const transcript = { version: 1, words: [] }
    const batch = [JSON.stringify(planA), JSON.stringify(planB)]
    const cs = node("cs", "camera-switch", { generatedJson: { edl: planA, transcript }, __listResults: batch })
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenderEdl(ae, [cs, ae], [edge("cs", "ae", "edl", "transcript")])).toEqual({
      value: JSON.stringify(transcript),
      source: "wire",
    })
  })

  // Every list the engines fan the render out over is judged item by item,
  // not as its first item (a List) or its whole text (Generate Text items).
  it("a List of EDLs: one render per row (a one-column List skips a blank row)", () => {
    const rows = node("l", "list", {
      columns: [{ id: "a", name: "EDL", handleId: "col_a", type: "text" }],
      rows: [[JSON.stringify(planA)], [""], [JSON.stringify(planB)]],
    })
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenderEdl(ae, [rows, ae], [edge("l", "ae", "edl", "col_a")])).toEqual({
      value: [JSON.stringify(planA), JSON.stringify(planB)],
      source: "plan",
    })
  })

  it("a List edge set to one item delivers that item, one render", () => {
    const rows = node("l", "list", {
      columns: [{ id: "a", name: "EDL", handleId: "col_a", type: "text" }],
      rows: [[JSON.stringify(planA)], [JSON.stringify(planB)]],
    })
    const ae = node("ae", "apply-edl")
    const e = { ...edge("l", "ae", "edl", "col_a"), data: { outputMode: "last" } }
    expect(resolveApplyEdlRenderEdl(ae, [rows, ae], [e])).toEqual({ value: JSON.stringify(planB), source: "wire" })
  })

  it("Generate Text's items: one render per item", () => {
    const writer = node("w", "llm-chat", { generatedText: `${JSON.stringify(planA)}\n===NEXT===\n${JSON.stringify(planB)}` })
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenderEdl(ae, [writer, ae], [edge("w", "ae", "edl", "items")])).toEqual({
      value: [JSON.stringify(planA), JSON.stringify(planB)],
      source: "plan",
    })
  })

  // The panel reads this through a store selector: an unchanged canvas must
  // hand back the same list, or the selector never settles.
  it("an unchanged canvas gives back the same list", () => {
    const plan = node("p", "edit-plan", { generatedJson: [planA, planB] })
    const ae = node("ae", "apply-edl")
    const edges = [edge("p", "ae", "edl")]
    expect(resolveApplyEdlRenderEdl(ae, [plan, ae], edges).value).toBe(resolveApplyEdlRenderEdl(ae, [plan, ae], edges).value)
  })

  // A2b: a wire from any other producer delivers what its output handle reads —
  // one value per run — where the dropped selection read nothing and fell back
  // to the inline EDL.
  it("any other producer: what its wire delivers, one value per run", () => {
    const text = node("t", "text-prompt", { text: JSON.stringify(planA) })
    const ae = node("ae", "apply-edl", { edl: planB })
    expect(resolveApplyEdlRenderEdl(ae, [text, ae], [edge("t", "ae", "edl")])).toEqual({ value: JSON.stringify(planA), source: "wire" })
    // An empty Text node delivers nothing: the inline EDL renders.
    const empty = node("t", "text-prompt", { text: "  " })
    expect(resolveApplyEdlRenderEdl(ae, [empty, ae], [edge("t", "ae", "edl")])).toEqual({ value: planB, source: "inline" })
  })

  it("nothing wired and nothing inline: nothing to judge", () => {
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenderEdl(ae, [ae], [])).toEqual({ value: undefined, source: "inline" })
  })
})

describe("resolveApplyEdlRenderSources", () => {
  const upload = (id: string, url?: string) => node(id, "upload-video", url ? { url } : {})

  it("the Sources wires' media, in edge order", () => {
    const ae = node("ae", "apply-edl")
    const nodes = [upload("u1", "https://cdn/1.mp4"), upload("u2", "https://cdn/2.mp4"), ae]
    expect(resolveApplyEdlRenderSources(ae, nodes, [edge("u1", "ae", "sources"), edge("u2", "ae", "sources")])).toEqual([
      "https://cdn/1.mp4",
      "https://cdn/2.mp4",
    ])
  })

  // Both engines append only a wire that delivers a value, so the overrides are
  // positional over the wires that DO: an empty first wire moves the next one
  // into slot 0.
  it("a wire whose producer delivers nothing takes no slot", () => {
    const ae = node("ae", "apply-edl")
    const nodes = [upload("empty"), upload("u2", "https://cdn/2.mp4"), ae]
    expect(resolveApplyEdlRenderSources(ae, nodes, [edge("empty", "ae", "sources"), edge("u2", "ae", "sources")])).toEqual([
      "https://cdn/2.mp4",
    ])
  })

  it("reads through a teleport, and ignores every other input", () => {
    const send = node("ts", "teleport-send")
    const recv = node("tr", "teleport-receive")
    const plan = node("p", "edit-plan", { generatedJson: edlOf(seg(0, 1000)) })
    const ae = node("ae", "apply-edl")
    const nodes = [upload("u", "https://cdn/u.mp4"), send, recv, plan, ae]
    const edges = [edge("u", "ts", "in"), edge("ts", "tr", "in"), edge("tr", "ae", "sources"), edge("p", "ae", "edl")]
    expect(resolveApplyEdlRenderSources(ae, nodes, edges)).toEqual(["https://cdn/u.mp4"])
  })

  it("no Sources wire: none", () => {
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenderSources(ae, [ae], [])).toEqual([])
  })
})

describe("applyEdlRenderContext — the node's settings as the render reads them", () => {
  it("defaults as the DAG payload builder does: video, hard cuts", () => {
    expect(applyEdlRenderContext({}, { source: "inline", sources: [] })).toEqual({
      clipList: false, output: "video", crossfadeMs: 0, sources: [],
    })
    expect(applyEdlRenderContext({ output: "nonsense", crossfadeMs: "500" }, { source: "wire", sources: [] })).toMatchObject({
      output: "video", crossfadeMs: 0, clipList: false,
    })
  })

  it("an audio render, its crossfade, its sources; a plan wire's list is a clip list", () => {
    const sources = ["https://cdn/1.mp4"]
    expect(applyEdlRenderContext({ output: "audio", crossfadeMs: 250 }, { source: "plan", sources })).toEqual({
      clipList: true, output: "audio", crossfadeMs: 250, sources,
    })
  })
})
