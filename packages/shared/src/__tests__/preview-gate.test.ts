import { describe, it, expect } from "vitest"
// Through the package index: the stop rule is the public surface both engines,
// the editor and SDK users decide "does this run stop at a preview?" with.
import {
  PREVIEW_RENDER_NODE_TYPES,
  PREVIEW_REVIEW_REQUIRED,
  PREVIEW_RENDER_NESTED,
  RUN_OVERRIDE_CLEARED_FIELDS,
  SAVED_RENDER_STAMPS,
  NO_SAVED_RENDER_STAMPS,
  rendersAsPreview,
  previewStops,
  previewGatedNodeIds,
  holdsPreviewRender,
  withRunOverrides,
  type PreviewGateNode,
  type PreviewGateEdge,
  type SavedRenderStampReader,
} from "../index.js"

const node = (id: string, type: string, data: Record<string, unknown> = {}, parentId?: string): PreviewGateNode => ({
  id,
  type,
  data,
  ...(parentId ? { parentId } : {}),
})
const edge = (source: string, target: string, extra: Partial<PreviewGateEdge> = {}): PreviewGateEdge => ({
  source,
  target,
  ...extra,
})

/** Tighten Episode's shape: transcribe → plan → render → captions → reply. */
function tighten(quality: "proxy" | "final" | undefined) {
  const nodes = [
    node("rec", "upload-video"),
    node("tx", "transcribe"),
    node("plan", "edit-plan"),
    node("cut", "apply-edl", quality ? { quality } : {}),
    node("cap", "add-captions"),
    node("reply", "telegram-reply"),
  ]
  const edges = [
    edge("rec", "tx"),
    edge("tx", "plan"),
    edge("plan", "cut", { targetHandle: "edl" }),
    edge("cut", "cap"),
    edge("cap", "reply"),
  ]
  return { nodes, edges }
}

describe("PREVIEW_RENDER_NODE_TYPES", () => {
  it("names the render nodes a run can stop at (apply-edl and speaker-view)", () => {
    expect([...PREVIEW_RENDER_NODE_TYPES]).toEqual(["apply-edl", "speaker-view"])
  })
})

describe("stable refusal codes", () => {
  it("are distinct, snake_case and stable (clients branch on them, never on text)", () => {
    expect(PREVIEW_REVIEW_REQUIRED).toBe("preview_review_required")
    expect(PREVIEW_RENDER_NESTED).toBe("preview_render_nested")
  })
})

describe("rendersAsPreview — the render's effective quality in this run", () => {
  it("is true only for a render node set to proxy", () => {
    expect(rendersAsPreview(node("a", "apply-edl", { quality: "proxy" }))).toBe(true)
    expect(rendersAsPreview(node("a", "apply-edl", { quality: "final" }))).toBe(false)
    expect(rendersAsPreview(node("a", "apply-edl", {}))).toBe(false)
    expect(rendersAsPreview(node("a", "speed-ramp", { quality: "proxy" }))).toBe(false)
  })
})

describe("previewStops — the derived stop rule (TA8 a)", () => {
  it("a run whose render is Proxy gates its whole forward closure, never the render itself", () => {
    const { nodes, edges } = tighten("proxy")
    const stops = previewStops(nodes, edges)
    expect(stops.previewRenderIds).toEqual(["cut"])
    expect(stops.savedPreviewRenderIds).toEqual([])
    expect([...stops.gatedNodeIds].sort()).toEqual(["cap", "reply"])
  })

  it("a Final render gates nothing", () => {
    const { nodes, edges } = tighten("final")
    expect(previewGatedNodeIds(nodes, edges).size).toBe(0)
    expect(holdsPreviewRender(nodes, edges)).toBe(false)
  })

  it("is a forward closure, not router gating: a Combine fed by the render AND an intro upload stops too", () => {
    const nodes = [
      node("plan", "edit-plan"),
      node("cut", "apply-edl", { quality: "proxy" }),
      node("intro", "upload-video"),
      node("combine", "combine-videos"),
      node("out", "webhook-output"),
    ]
    const edges = [edge("plan", "cut"), edge("cut", "combine"), edge("intro", "combine"), edge("combine", "out")]
    expect([...previewGatedNodeIds(nodes, edges)].sort()).toEqual(["combine", "out"])
  })

  it("follows every way a node feeds another: teleports, Group membership and field mappings", () => {
    const nodes = [
      node("cut", "apply-edl", { quality: "proxy" }),
      node("send", "teleport-send"),
      node("recv", "teleport-receive"),
      node("cap", "add-captions", {}, "grp"),
      node("grp", "group"),
      node("llm", "llm-chat", { fieldMappings: { prompt: { sourceNodeId: "cap" } } }),
    ]
    const edges = [edge("cut", "send"), edge("send", "recv"), edge("recv", "cap")]
    expect([...previewGatedNodeIds(nodes, edges)].sort()).toEqual(["cap", "grp", "llm", "recv", "send"])
  })

  it("a render that does not execute in this run is not a Preview by its config (its SAVED output decides)", () => {
    const { nodes, edges } = tighten("proxy")
    const stops = previewStops(nodes, edges, { executes: (id) => id !== "cut" })
    expect(stops.previewRenderIds).toEqual([])
    expect(stops.gatedNodeIds.size).toBe(0)
  })

  it("a frozen (skipped) render does not execute by default", () => {
    const { nodes, edges } = tighten("proxy")
    const frozen = nodes.map((n) => (n.id === "cut" ? { ...n, data: { ...(n.data as object), skipped: true } } : n))
    expect(previewStops(frozen, edges).previewRenderIds).toEqual([])
  })

  it("a render downstream of another preview is itself gated (it would consume a preview)", () => {
    const nodes = [node("a", "apply-edl", { quality: "proxy" }), node("b", "apply-edl", { quality: "proxy" })]
    const edges = [edge("a", "b", { targetHandle: "sources" })]
    const stops = previewStops(nodes, edges)
    expect(stops.previewRenderIds).toEqual(["a", "b"])
    expect([...stops.gatedNodeIds]).toEqual(["b"])
  })

  it("ignores edges whose ends are not on the graph", () => {
    const { nodes, edges } = tighten("proxy")
    expect([...previewGatedNodeIds(nodes, [...edges, edge("cut", "ghost")])].sort()).toEqual(["cap", "reply"])
  })
})

describe("previewStops — the saved-preview half (TA8 a, second case)", () => {
  // A stand-in for the saved-output reader (`savedRenderOutput` /
  // `savedRenderBatch`): the selected result is the Final, the latest batch
  // holds a Preview.
  const reader: SavedRenderStampReader = {
    output: (data) => (data.selected === "proxy" ? { quality: "proxy" } : { quality: "final" }),
    batch: (data) => (Array.isArray(data.batch) ? (data.batch as string[]).map((q) => (q ? { quality: q } : null)) : undefined),
  }
  const outsideRun = { executes: (id: string) => id !== "cut", savedRenders: reader }

  it("a scalar edge from a saved render whose selected result is a Final stays open", () => {
    const nodes = [node("cut", "apply-edl", { batch: ["proxy"] }), node("cap", "add-captions"), node("out", "webhook-output")]
    const edges = [edge("cut", "cap"), edge("cap", "out")]
    const stops = previewStops(nodes, edges, outsideRun)
    expect(stops.savedPreviewRenderIds).toEqual([])
    expect(stops.gatedNodeIds.size).toBe(0)
  })

  it("a scalar edge from a saved render whose selected result is a Preview is gated, with its closure", () => {
    const nodes = [node("cut", "apply-edl", { selected: "proxy" }), node("cap", "add-captions"), node("out", "webhook-output")]
    const edges = [edge("cut", "cap"), edge("cap", "out")]
    const stops = previewStops(nodes, edges, outsideRun)
    expect(stops.savedPreviewRenderIds).toEqual(["cut"])
    expect([...stops.gatedNodeIds].sort()).toEqual(["cap", "out"])
  })

  it("an each edge reads the latest batch: one Preview row in it gates the consumer (TA6)", () => {
    const nodes = [node("cut", "apply-edl", { batch: ["final", "", "proxy"] }), node("cap", "add-captions")]
    const edges = [edge("cut", "cap", { data: { outputMode: "each" } })]
    expect([...previewStops(nodes, edges, outsideRun).gatedNodeIds]).toEqual(["cap"])
  })

  it("an each edge from a render with no batch reads its one result", () => {
    const nodes = [node("cut", "apply-edl", { selected: "proxy" }), node("cap", "add-captions")]
    const edges = [edge("cut", "cap", { data: { outputMode: "each" } })]
    expect([...previewStops(nodes, edges, outsideRun).gatedNodeIds]).toEqual(["cap"])
  })

  it("decides per edge: the each consumer stops while the scalar one reads the selected Final", () => {
    const nodes = [node("cut", "apply-edl", { batch: ["proxy"] }), node("each", "add-captions"), node("one", "upload-post")]
    const edges = [edge("cut", "each", { data: { outputMode: "each" } }), edge("cut", "one")]
    expect([...previewStops(nodes, edges, outsideRun).gatedNodeIds]).toEqual(["each"])
  })

  it("a field mapping or Group fed by the saved render reads its one result", () => {
    const nodes = [
      node("cut", "apply-edl", { selected: "proxy" }, "grp"),
      node("grp", "group"),
      node("llm", "llm-chat", { fieldMappings: { prompt: { sourceNodeId: "cut" } } }),
    ]
    expect([...previewStops(nodes, [], outsideRun).gatedNodeIds].sort()).toEqual(["grp", "llm"])
  })

  // Through a teleport pair the resolvers read the CONSUMER's wire: its own
  // outputMode, else the default for the real source (the render) on the
  // render-side handle. The render → send wire's mode is never read.
  it("through a teleport pair, an each consumer reads the latest batch and stops", () => {
    const nodes = [
      node("cut", "apply-edl", { batch: ["proxy"] }),
      node("send", "teleport-send"),
      node("recv", "teleport-receive"),
      node("cap", "add-captions"),
      node("out", "webhook-output"),
    ]
    const edges = [
      edge("cut", "send"),
      edge("send", "recv"),
      edge("recv", "cap", { data: { outputMode: "each" } }),
      edge("cap", "out"),
    ]
    const stops = previewStops(nodes, edges, outsideRun)
    expect(stops.savedPreviewRenderIds).toEqual(["cut"])
    expect([...stops.gatedNodeIds].sort()).toEqual(["cap", "out"])
  })

  it("through a teleport pair, a scalar consumer reads the selected Final even when the send wire says each", () => {
    const nodes = [
      node("cut", "apply-edl", { batch: ["proxy"] }),
      node("send", "teleport-send"),
      node("recv", "teleport-receive"),
      node("cap", "add-captions"),
    ]
    const edges = [
      edge("cut", "send", { data: { outputMode: "each" } }),
      edge("send", "recv"),
      edge("recv", "cap"),
    ]
    expect(previewStops(nodes, edges, outsideRun).gatedNodeIds.size).toBe(0)
  })

  it("through a teleport pair, decides per consumer: only the each one stops", () => {
    const nodes = [
      node("cut", "apply-edl", { batch: ["proxy"] }),
      node("send", "teleport-send"),
      node("recv", "teleport-receive"),
      node("each", "add-captions"),
      node("one", "upload-post"),
    ]
    const edges = [
      edge("cut", "send"),
      edge("send", "recv"),
      edge("recv", "each", { data: { outputMode: "each" } }),
      edge("recv", "one"),
    ]
    expect([...previewStops(nodes, edges, outsideRun).gatedNodeIds]).toEqual(["each"])
  })

  it("is inert in production until the saved-output reader is plugged in (no result carries a stamp yet)", () => {
    expect(SAVED_RENDER_STAMPS).toBe(NO_SAVED_RENDER_STAMPS)
    const nodes = [node("cut", "apply-edl", { selected: "proxy", batch: ["proxy"] }), node("cap", "add-captions")]
    const edges = [edge("cut", "cap")]
    expect(previewStops(nodes, edges, { executes: (id) => id !== "cut" }).gatedNodeIds.size).toBe(0)
  })
})

describe("holdsPreviewRender — is there anything a reviewer would have to review?", () => {
  it("true for a Preview render in the run, even with nothing downstream of it", () => {
    expect(holdsPreviewRender([node("cut", "apply-edl", { quality: "proxy" })], [])).toBe(true)
  })

  it("true for a saved Preview the run would hand downstream", () => {
    const reader: SavedRenderStampReader = { output: () => ({ quality: "proxy" }), batch: () => undefined }
    const nodes = [node("cut", "apply-edl"), node("cap", "add-captions")]
    expect(holdsPreviewRender(nodes, [edge("cut", "cap")], { executes: (id) => id !== "cut", savedRenders: reader })).toBe(true)
  })
})

describe("withRunOverrides — the run's graph after its input overrides", () => {
  it("a Final override on the render lifts the stop (Render final's one-shot override, TA18)", () => {
    const { nodes, edges } = tighten("proxy")
    const run = withRunOverrides(nodes, { cut: { quality: "final" } })
    expect(previewGatedNodeIds(run, edges).size).toBe(0)
    // The saved graph is never mutated.
    expect((nodes.find((n) => n.id === "cut")!.data as { quality: string }).quality).toBe("proxy")
  })

  it("a proxy override on a Final render stops the run (Update preview)", () => {
    const { nodes, edges } = tighten("final")
    expect([...previewGatedNodeIds(withRunOverrides(nodes, { cut: { quality: "proxy" } }), edges)].sort()).toEqual(["cap", "reply"])
  })

  it("clears the overridden node's saved results, as the server merge does", () => {
    const n = node("cut", "apply-edl", {
      quality: "proxy",
      generatedResults: [{ url: "u" }],
      activeResultIndex: 0,
      generatedVideoUrl: "u",
      generatedAudioUrl: "a",
      generatedImageUrl: "i",
      generatedText: "t",
      label: "Cut",
    })
    const [merged] = withRunOverrides([n], { cut: { quality: "final" } })
    for (const key of RUN_OVERRIDE_CLEARED_FIELDS) expect(merged.data).not.toHaveProperty(key)
    expect(merged.data).toMatchObject({ quality: "final", label: "Cut" })
  })

  it("leaves nodes with no override untouched (same object)", () => {
    const { nodes } = tighten("proxy")
    const run = withRunOverrides(nodes, { cut: { quality: "final" } })
    expect(run[0]).toBe(nodes[0])
    expect(withRunOverrides(nodes, undefined)).toEqual(nodes)
  })
})
