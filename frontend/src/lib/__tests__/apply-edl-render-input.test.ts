import { describe, it, expect } from "vitest"
import {
  applyEdlRenderSettings,
  resolveApplyEdlRenders,
  stableApplyEdlRenders,
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

// The Apply EDL panel badge judges every render the node's Run would make now:
// the fan-out the browser engine plans, then each render's inputs as it resolves
// them (#1789 built the EDL selection; A2b judged it with the render rule; each
// render's own Sources follow, decided 2026-10-05).
const one = (edl: unknown, sources: readonly string[] = []) => [{ edl, sources }]
const per = (...renders: Array<[row: number, edl: unknown, sources?: readonly string[]]>) =>
  renders.map(([row, edl, sources = []]) => ({ row, edl, sources }))

describe("resolveApplyEdlRenders — the EDL each render reads", () => {
  const planA = edlOf(seg(0, 60_000))
  const planB = edlOf(seg(0, 120_000))

  it("nothing wired: the inline EDL", () => {
    const ae = node("ae", "apply-edl", { edl: planA })
    expect(resolveApplyEdlRenders(ae, [ae], [])).toEqual(one(planA))
  })

  it("wired: what the wire delivers, read through a teleport", () => {
    const plan = node("p", "edit-plan", { generatedJson: planA })
    const send = node("ts", "teleport-send")
    const recv = node("tr", "teleport-receive")
    const ae = node("ae", "apply-edl", { edl: planB })
    const nodes = [plan, send, recv, ae]
    const edges = [edge("p", "ts", "in"), edge("ts", "tr", "in"), edge("tr", "ae", "edl")]
    expect(resolveApplyEdlRenders(ae, nodes, edges)).toEqual(one(JSON.stringify(planA)))
  })

  it("two wires: the LAST one, as both engines keep the last value", () => {
    const p1 = node("p1", "edit-plan", { generatedJson: planA })
    const p2 = node("p2", "edit-plan", { generatedJson: planB })
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenders(ae, [p1, p2, ae], [edge("p1", "ae", "edl"), edge("p2", "ae", "edl")])).toEqual(one(JSON.stringify(planB)))
  })

  // The engines skip a wire whose producer yields nothing (`if (!output)
  // continue`), then render `inputs.edl ?? data.edl`.
  it("the last wire whose producer holds a plan — an empty last wire is skipped", () => {
    const p1 = node("p1", "edit-plan", { generatedJson: planA })
    const p2 = node("p2", "edit-plan") // not run yet
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenders(ae, [p1, p2, ae], [edge("p1", "ae", "edl"), edge("p2", "ae", "edl")])).toEqual(one(JSON.stringify(planA)))
  })

  it("every wire empty: the inline EDL renders", () => {
    const plan = node("p", "edit-plan", { generatedJson: [] })
    const ae = node("ae", "apply-edl", { edl: planA })
    expect(resolveApplyEdlRenders(ae, [plan, ae], [edge("p", "ae", "edl")])).toEqual(one(planA))
  })

  it("a clips plan stays the clip list, one render per clip", () => {
    const plan = node("p", "edit-plan", { generatedJson: [planA, planB] })
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenders(ae, [plan, ae], [edge("p", "ae", "edl")])).toEqual(
      per([0, JSON.stringify(planA)], [1, JSON.stringify(planB)]),
    )
  })

  // A plan of one clip renders once, that clip, as both engines read it.
  it("a clips plan of one clip: that clip, one render", () => {
    const plan = node("p", "edit-plan", { generatedJson: [planA] })
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenders(ae, [plan, ae], [edge("p", "ae", "edl")])).toEqual(one(JSON.stringify(planA)))
  })

  it("Camera Switch: its switched EDL, or the whole per-clip batch (JSON strings, as every lane stores it)", () => {
    const single = node("cs", "camera-switch", { generatedJson: { edl: planA, transcript: {} } })
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenders(ae, [single, ae], [edge("cs", "ae", "edl")])).toEqual(one(JSON.stringify(planA)))
    const batch = [JSON.stringify(planA), JSON.stringify(planB)]
    const many = node("cs", "camera-switch", { generatedJson: { edl: planB, transcript: {} }, __listResults: batch })
    expect(resolveApplyEdlRenders(ae, [many, ae], [edge("cs", "ae", "edl")])).toEqual(per([0, batch[0]], [1, batch[1]]))
  })

  // Both engines read Camera Switch's Transcript output as one value, whatever
  // its batch holds: wired into the EDL input, the transcript is what renders.
  it("Camera Switch's transcript wire: the transcript, never the switched plan", () => {
    const transcript = { version: 1, words: [] }
    const batch = [JSON.stringify(planA), JSON.stringify(planB)]
    const cs = node("cs", "camera-switch", { generatedJson: { edl: planA, transcript }, __listResults: batch })
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenders(ae, [cs, ae], [edge("cs", "ae", "edl", "transcript")])).toEqual(one(JSON.stringify(transcript)))
  })

  // Every list the engines fan the render out over is judged item by item,
  // not as its first item (a List) or its whole text (Generate Text items).
  it("a List of EDLs: one render per row (a one-column List skips a blank row)", () => {
    const rows = node("l", "list", {
      columns: [{ id: "a", name: "EDL", handleId: "col_a", type: "text" }],
      rows: [[JSON.stringify(planA)], [""], [JSON.stringify(planB)]],
    })
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenders(ae, [rows, ae], [edge("l", "ae", "edl", "col_a")])).toEqual(
      // The run's rows: a one-column List's blank row is not a row it runs.
      per([0, JSON.stringify(planA)], [1, JSON.stringify(planB)]),
    )
  })

  it("a List edge set to one item delivers that item, one render", () => {
    const rows = node("l", "list", {
      columns: [{ id: "a", name: "EDL", handleId: "col_a", type: "text" }],
      rows: [[JSON.stringify(planA)], [JSON.stringify(planB)]],
    })
    const ae = node("ae", "apply-edl")
    const e = { ...edge("l", "ae", "edl", "col_a"), data: { outputMode: "last" } }
    expect(resolveApplyEdlRenders(ae, [rows, ae], [e])).toEqual(one(JSON.stringify(planB)))
  })

  it("Generate Text's items: one render per item", () => {
    const writer = node("w", "llm-chat", { generatedText: `${JSON.stringify(planA)}\n===NEXT===\n${JSON.stringify(planB)}` })
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenders(ae, [writer, ae], [edge("w", "ae", "edl", "items")])).toEqual(
      per([0, JSON.stringify(planA)], [1, JSON.stringify(planB)]),
    )
  })

  // The panel reads this through a store selector: an unchanged canvas must
  // hand back the same list, or the selector never settles.
  it("an unchanged canvas gives back the same renders", () => {
    const plan = node("p", "edit-plan", { generatedJson: [planA, planB] })
    const ae = node("ae", "apply-edl")
    const edges = [edge("p", "ae", "edl")]
    const first = resolveApplyEdlRenders(ae, [plan, ae], edges)
    expect(stableApplyEdlRenders(first, resolveApplyEdlRenders(ae, [plan, ae], edges))).toBe(first)
    const changed = resolveApplyEdlRenders(ae, [node("p", "edit-plan", { generatedJson: [planB, planA] }), ae], edges)
    expect(stableApplyEdlRenders(first, changed)).toBe(changed)
  })

  // A2b: a wire from any other producer delivers what its output handle reads —
  // one value per run — where the dropped selection read nothing and fell back
  // to the inline EDL.
  it("any other producer: what its wire delivers, one value per run", () => {
    const text = node("t", "text-prompt", { text: JSON.stringify(planA) })
    const ae = node("ae", "apply-edl", { edl: planB })
    expect(resolveApplyEdlRenders(ae, [text, ae], [edge("t", "ae", "edl")])).toEqual(one(JSON.stringify(planA)))
    // An empty Text node delivers nothing: the inline EDL renders.
    const empty = node("t", "text-prompt", { text: "  " })
    expect(resolveApplyEdlRenders(ae, [empty, ae], [edge("t", "ae", "edl")])).toEqual(one(planB))
  })

  it("nothing wired and nothing inline: nothing to judge", () => {
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenders(ae, [ae], [])).toEqual(one(undefined))
  })
})

describe("resolveApplyEdlRenders — the Sources each render reads", () => {
  const upload = (id: string, url?: string) => node(id, "upload-video", url ? { url } : {})
  const sourcesOf = (ae: ReturnType<typeof node>, nodes: ReturnType<typeof node>[], edges: ReturnType<typeof edge>[]) =>
    resolveApplyEdlRenders(ae, nodes, edges).map((r) => r.sources)

  it("the Sources wires' media, in edge order", () => {
    const ae = node("ae", "apply-edl")
    const nodes = [upload("u1", "https://cdn/1.mp4"), upload("u2", "https://cdn/2.mp4"), ae]
    expect(sourcesOf(ae, nodes, [edge("u1", "ae", "sources"), edge("u2", "ae", "sources")])).toEqual([
      ["https://cdn/1.mp4", "https://cdn/2.mp4"],
    ])
  })

  // Both engines append only a wire that delivers a value, so the overrides are
  // positional over the wires that DO: an empty first wire moves the next one
  // into slot 0.
  it("a wire whose producer delivers nothing takes no slot", () => {
    const ae = node("ae", "apply-edl")
    const nodes = [upload("empty"), upload("u2", "https://cdn/2.mp4"), ae]
    expect(sourcesOf(ae, nodes, [edge("empty", "ae", "sources"), edge("u2", "ae", "sources")])).toEqual([["https://cdn/2.mp4"]])
  })

  it("reads through a teleport, and ignores every other input", () => {
    const send = node("ts", "teleport-send")
    const recv = node("tr", "teleport-receive")
    const plan = node("p", "edit-plan", { generatedJson: edlOf(seg(0, 1000)) })
    const ae = node("ae", "apply-edl")
    const nodes = [upload("u", "https://cdn/u.mp4"), send, recv, plan, ae]
    const edges = [edge("u", "ts", "in"), edge("ts", "tr", "in"), edge("tr", "ae", "sources"), edge("p", "ae", "edl")]
    expect(sourcesOf(ae, nodes, edges)).toEqual([["https://cdn/u.mp4"]])
  })

  it("no Sources wire: none", () => {
    const ae = node("ae", "apply-edl")
    expect(sourcesOf(ae, [ae], [])).toEqual([[]])
  })

  // Decided 2026-10-05: a list wired into Sources fans the render out like an
  // EDL list does, and each render reads its own row's media.
  const cams = (rows: string[][]) =>
    node("l", "list", {
      columns: [
        { id: "a", name: "A", handleId: "col_a", type: "text" },
        { id: "b", name: "B", handleId: "col_b", type: "text" },
      ],
      rows,
    })

  it("a List wired into Sources: one render per row, each with that row's media", () => {
    const plan = node("p", "edit-plan", { generatedJson: edlOf(seg(0, 1000)) })
    const ae = node("ae", "apply-edl")
    const list = cams([["https://cdn/a0.mp4", "https://cdn/b0.mp4"], ["https://cdn/a1.mp4", ""]])
    const edges = [edge("p", "ae", "edl"), edge("l", "ae", "sources", "col_a"), edge("l", "ae", "sources", "col_b")]
    const plan0 = JSON.stringify(edlOf(seg(0, 1000)))
    // The second row has no second camera: its render gets one override.
    expect(resolveApplyEdlRenders(ae, [plan, list, ae], edges)).toEqual(
      per([0, plan0, ["https://cdn/a0.mp4", "https://cdn/b0.mp4"]], [1, plan0, ["https://cdn/a1.mp4"]]),
    )
  })

  it("a plan's clips and a List of media with the same rows pair up, row by row", () => {
    const planA = edlOf(seg(0, 1000))
    const planB = edlOf(seg(0, 2000))
    const plan = node("p", "edit-plan", { generatedJson: [planA, planB] })
    const media = node("m", "list", {
      columns: [{ id: "a", name: "Media", handleId: "col_a", type: "text" }],
      rows: [["https://cdn/0.mp4"], ["https://cdn/1.mp4"]],
    })
    const ae = node("ae", "apply-edl")
    expect(resolveApplyEdlRenders(ae, [plan, media, ae], [edge("p", "ae", "edl"), edge("m", "ae", "sources", "col_a")])).toEqual(
      per([0, JSON.stringify(planA), ["https://cdn/0.mp4"]], [1, JSON.stringify(planB), ["https://cdn/1.mp4"]]),
    )
  })
})

describe("applyEdlRenderSettings — the node's settings as the render reads them", () => {
  it("defaults as the DAG payload builder does: video, hard cuts", () => {
    expect(applyEdlRenderSettings({})).toEqual({ output: "video", crossfadeMs: 0 })
    expect(applyEdlRenderSettings({ output: "nonsense", crossfadeMs: "500" })).toEqual({ output: "video", crossfadeMs: 0 })
  })

  it("an audio render and its crossfade", () => {
    expect(applyEdlRenderSettings({ output: "audio", crossfadeMs: 250 })).toEqual({ output: "audio", crossfadeMs: 250 })
  })
})
