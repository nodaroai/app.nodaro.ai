/**
 * Structural validation for the podcast editing templates (PR #12).
 *
 * A seeded template that does not load is worse than none: the workflow it seeds
 * must reference REAL node types and REAL handles, or a clone opens broken. The
 * POST/PATCH /v1/workflows route validates loosely (a node-type denylist + a
 * handle migration), so the real guard for a shipped template's wiring is here.
 *
 * For every node in each template this asserts the type is registered in
 * NODE_HANDLES (the generated handle registry — the same source /v1/nodes and
 * gen:skills read), and every edge's `source`/`target` id exists and its
 * `sourceHandle`/`targetHandle` is a real handle on that node. The `list` node
 * is special-cased: its handles are dynamic per column (`col_<id>` out,
 * `col_<id>_in` in), derived from `data.columns[]`, not the static NODE_HANDLES
 * entry (which only carries the bare `in`).
 */
import { describe, it, expect } from "vitest"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { TEMPLATE_CATEGORIES, isKineticCaptionStyle } from "@nodaro/shared"
import { NODE_HANDLES } from "../../mcp/generated/node-handles.js"
import type { TutorialTemplateDoc } from "../types.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(HERE, "..", "templates")

const SLUGS = ["podcast-tighten-episode", "podcast-clip-pack", "podcast-multicam-cut"] as const

async function loadTemplate(slug: string): Promise<TutorialTemplateDoc> {
  return JSON.parse(await readFile(join(TEMPLATES_DIR, `${slug}.json`), "utf8")) as TutorialTemplateDoc
}

type Node = { id: string; type: string; data?: Record<string, unknown> }
type Edge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: Record<string, unknown> }

/** The valid input/output handle ids for a node, resolving the `list` node's
 *  dynamic per-column handles from its stored columns. */
function handlesFor(node: Node): { inputs: Set<string>; outputs: Set<string> } {
  const spec = NODE_HANDLES[node.type]
  const inputs = new Set<string>(spec?.inputs ?? [])
  const outputs = new Set<string>(spec?.outputs ?? [])
  if (node.type === "list") {
    const columns = (node.data?.columns ?? []) as Array<{ handleId?: string }>
    for (const col of columns) {
      if (typeof col.handleId === "string" && col.handleId) {
        outputs.add(col.handleId)
        inputs.add(`${col.handleId}_in`)
      }
    }
  }
  return { inputs, outputs }
}

describe("podcast editing templates — structural validity", () => {
  for (const slug of SLUGS) {
    describe(slug, () => {
      it("declares the required marketplace card metadata", async () => {
        const t = await loadTemplate(slug)
        expect(t.slug).toBe(slug)
        expect(t.name.length).toBeGreaterThan(0)
        expect(TEMPLATE_CATEGORIES).toContain(t.category)
        expect(t.outputTypes).toEqual(["video"])
        expect(t.listedIn).toEqual(["marketplace"])
        expect(typeof t.tutorialCategorySlug).toBe("string")
        expect(typeof t.tutorialSortOrder).toBe("number")
        expect(Array.isArray(t.nodes)).toBe(true)
        expect(Array.isArray(t.edges)).toBe(true)
        expect((t.nodes as Node[]).length).toBeGreaterThan(0)
      })

      it("uses only registered node types", async () => {
        const t = await loadTemplate(slug)
        for (const node of t.nodes as Node[]) {
          expect(node.id, `node ${JSON.stringify(node.id)} has an id`).toBeTruthy()
          expect(
            NODE_HANDLES[node.type],
            `node type "${node.type}" (node ${node.id}) is registered in NODE_HANDLES`,
          ).toBeDefined()
        }
      })

      it("wires every edge to a real handle on a real node", async () => {
        const t = await loadTemplate(slug)
        const byId = new Map((t.nodes as Node[]).map((n) => [n.id, n]))
        for (const edge of t.edges as Edge[]) {
          const src = byId.get(edge.source)
          const tgt = byId.get(edge.target)
          expect(src, `edge ${edge.id} source node "${edge.source}" exists`).toBeDefined()
          expect(tgt, `edge ${edge.id} target node "${edge.target}" exists`).toBeDefined()

          const srcHandles = handlesFor(src!)
          const tgtHandles = handlesFor(tgt!)
          expect(
            typeof edge.sourceHandle === "string" && srcHandles.outputs.has(edge.sourceHandle),
            `edge ${edge.id}: "${edge.sourceHandle}" is a real OUTPUT of ${src!.type} (${edge.source}) — has [${[...srcHandles.outputs].join(", ")}]`,
          ).toBe(true)
          expect(
            typeof edge.targetHandle === "string" && tgtHandles.inputs.has(edge.targetHandle),
            `edge ${edge.id}: "${edge.targetHandle}" is a real INPUT of ${tgt!.type} (${edge.target}) — has [${[...tgtHandles.inputs].join(", ")}]`,
          ).toBe(true)
        }
      })
    })
  }

  it("Tighten Episode captions from the remapped transcript (apply-edl json), not the raw one", async () => {
    const t = await loadTemplate("podcast-tighten-episode")
    const nodes = t.nodes as Node[]
    const captions = nodes.find((n) => n.type === "add-captions")!
    const applyEdl = nodes.find((n) => n.type === "apply-edl")!
    expect(captions).toBeDefined()
    const transcriptEdge = (t.edges as Edge[]).find(
      (e) => e.target === captions.id && e.targetHandle === "transcript",
    )
    expect(transcriptEdge, "add-captions has a transcript edge").toBeDefined()
    expect(transcriptEdge!.source).toBe(applyEdl.id)
    expect(transcriptEdge!.sourceHandle).toBe("json")
    // A wired transcript requires a KINETIC caption style (payload-builder throws
    // otherwise, since a non-kinetic subtitle style ignores the transcript).
    const capStyle = (captions.data as { style?: string }).style
    expect(isKineticCaptionStyle(capStyle), `add-captions style "${capStyle}" is kinetic`).toBe(true)
    // edit-plan is in tighten mode with no fan-out list.
    expect((nodes.find((n) => n.type === "edit-plan")!.data as { mode?: string }).mode).toBe("tighten")
    expect(nodes.some((n) => n.type === "list")).toBe(false)
  })

  it("Clip Pack fans out edit-plan directly into per-clip render + self-transcribed word-level captions", async () => {
    const t = await loadTemplate("podcast-clip-pack")
    const nodes = t.nodes as Node[]
    const edges = t.edges as Edge[]

    const plan = nodes.find((n) => n.type === "edit-plan")!
    expect((plan.data as { mode?: string }).mode).toBe("clips")

    // The current engine's fan-out carrier (listResults) is primary-only, so the
    // fan-out is a DIRECT edit-plan → apply-edl edge (edit-plan ∈ FAN_OUT_EACH_TYPES),
    // not a `list` staging node, and there is no fan-in `collect` (it can't gather
    // a member's fan-out results). Both deferred to later engine work.
    expect(nodes.some((n) => n.type === "list"), "no list staging node").toBe(false)
    expect(nodes.some((n) => n.type === "collect"), "no collect fan-in node").toBe(false)

    // edit-plan:edl → apply-edl:edl (fans out one render per clip)
    const applyEdl = nodes.find((n) => n.type === "apply-edl")!
    const planToApply = edges.find((e) => e.source === plan.id && e.target === applyEdl.id)
    expect(planToApply, "edit-plan → apply-edl edge exists").toBeDefined()
    expect(planToApply!.sourceHandle).toBe("edl")
    expect(planToApply!.targetHandle).toBe("edl")

    // apply-edl:media → add-captions:in needs an EXPLICIT outputMode "each":
    // apply-edl is NOT in FAN_OUT_EACH_TYPES, so this edge would default to
    // "last" (only the final clip captioned). The edit-plan → apply-edl edge
    // above needs no flag — edit-plan IS in the set, so it defaults to "each".
    const captions = nodes.find((n) => n.type === "add-captions")!
    const applyToCaptions = edges.find((e) => e.source === applyEdl.id && e.target === captions.id)
    expect(applyToCaptions, "apply-edl → add-captions edge exists").toBeDefined()
    expect(applyToCaptions!.sourceHandle).toBe("media")
    expect(applyToCaptions!.targetHandle).toBe("in")
    expect((applyToCaptions!.data as { outputMode?: string } | undefined)?.outputMode).toBe("each")

    // word-level karaoke captions, self-sourced per clip (autoTranscribe) — no
    // wired transcript edge (the per-clip remap pairing is deferred engine work).
    expect((captions.data as { wordLevel?: boolean }).wordLevel).toBe(true)
    expect(isKineticCaptionStyle((captions.data as { style?: string }).style)).toBe(true)
    expect((captions.data as { autoTranscribe?: boolean }).autoTranscribe).toBe(true)
    const capTranscript = edges.find((e) => e.target === captions.id && e.targetHandle === "transcript")
    expect(capTranscript, "add-captions has NO wired transcript edge").toBeUndefined()
  })

  describe("Multicam Cut", () => {
    function only(nodes: Node[], type: string): Node {
      const found = nodes.filter((n) => n.type === type)
      expect(found, `exactly one ${type} node`).toHaveLength(1)
      return found[0]!
    }
    function into(edges: Edge[], target: Node, handle: string): Edge[] {
      return edges.filter((e) => e.target === target.id && e.targetHandle === handle)
    }

    it("wires the multicam chain: sources → Audio Sync + Transcribe(master) → Edit Plan(tighten) → Camera Switch → Apply EDL", async () => {
      const t = await loadTemplate("podcast-multicam-cut")
      const nodes = t.nodes as Node[]
      const edges = t.edges as Edge[]

      const master = only(nodes, "upload-audio")
      const cameras = nodes.filter((n) => n.type === "upload-video")
      expect(cameras.length, "2–5 cameras beside the master (2–6 sources in total)").toBeGreaterThanOrEqual(2)
      expect(cameras.length).toBeLessThanOrEqual(5)
      const recordings = [master, ...cameras]

      const sync = only(nodes, "audio-sync")
      const transcribe = only(nodes, "transcribe")
      const plan = only(nodes, "edit-plan")
      const cameraSwitch = only(nodes, "camera-switch")
      const apply = only(nodes, "apply-edl")

      // Every recording feeds BOTH Audio Sync and Edit Plan's Sources — offsets
      // are matched to sources by upstream node.
      for (const handle of [[sync, "sources"], [plan, "sources"]] as const) {
        expect(into(edges, handle[0], handle[1]).map((e) => e.source).sort()).toEqual(recordings.map((n) => n.id).sort())
      }
      // Audio Sync measures against the master; its result lands on Offsets.
      expect((sync.data as { reference?: string }).reference).toBe(master.id)
      expect(into(edges, plan, "offsets").map((e) => [e.source, e.sourceHandle])).toEqual([[sync.id, "json"]])

      // Transcribe hears the MASTER (the plan refuses a transcript off the
      // master's clock), diarized (Camera Switch refuses one with no speakers).
      expect(into(edges, transcribe, "audio").map((e) => e.source)).toEqual([master.id])
      expect((transcribe.data as { diarize?: boolean }).diarize).toBe(true)
      expect(into(edges, plan, "transcript").map((e) => [e.source, e.sourceHandle])).toEqual([[transcribe.id, "json"]])

      // Edit Plan tightens on the master's clock: the master is marked master
      // audio and leads the source order; no offset is typed (a typed offset
      // beats the measured one).
      const planData = plan.data as {
        mode?: string
        sourceOrder?: string[]
        sourceConfig?: Record<string, { role?: string; offsetMs?: number }>
      }
      expect(planData.mode).toBe("tighten")
      expect(planData.sourceOrder?.[0]).toBe(master.id)
      expect([...(planData.sourceOrder ?? [])].sort()).toEqual(recordings.map((n) => n.id).sort())
      expect(planData.sourceConfig?.[master.id]?.role).toBe("master-audio")
      for (const cam of cameras) expect(["camera", "wide"]).toContain(planData.sourceConfig?.[cam.id]?.role)
      for (const cfg of Object.values(planData.sourceConfig ?? {})) expect(cfg.offsetMs).toBeUndefined()

      // Camera Switch reads the plan's edit and the diarized transcript.
      expect(into(edges, cameraSwitch, "edl").map((e) => [e.source, e.sourceHandle])).toEqual([[plan.id, "edl"]])
      expect(into(edges, cameraSwitch, "transcript").map((e) => [e.source, e.sourceHandle])).toEqual([[transcribe.id, "json"]])

      // Apply EDL renders the SWITCHED edit (and the named transcript, remapped
      // onto the cut for captions added later).
      expect(into(edges, apply, "edl").map((e) => [e.source, e.sourceHandle])).toEqual([[cameraSwitch.id, "edl"]])
      expect(into(edges, apply, "transcript").map((e) => [e.source, e.sourceHandle])).toEqual([[cameraSwitch.id, "transcript"]])
      // Media resolves from the EDL's sources: no camera is wired as an override.
      expect(into(edges, apply, "sources")).toEqual([])
      // Nothing renders after it in this template.
      expect(edges.filter((e) => e.source === apply.id)).toEqual([])
    })

    it("turns Camera Switch's layout hints OFF so the EDL is cut-only and Apply EDL can render it (decided 2026-09-23)", async () => {
      const t = await loadTemplate("podcast-multicam-cut")
      const cameraSwitch = only(t.nodes as Node[], "camera-switch")
      // Written explicitly, not left to the node's default.
      expect((cameraSwitch.data as { layoutHints?: boolean }).layoutHints).toBe(false)
    })

    it("renders at the same quality as the other podcast templates (Final)", async () => {
      for (const slug of SLUGS) {
        const t = await loadTemplate(slug)
        const apply = only(t.nodes as Node[], "apply-edl")
        expect((apply.data as { quality?: string }).quality, slug).toBe("final")
      }
    })

    it("lists the node types and providers it actually uses", async () => {
      const t = await loadTemplate("podcast-multicam-cut")
      const nodes = t.nodes as Node[]
      expect([...(t.nodeTypesUsed ?? [])].sort()).toEqual([...new Set(nodes.map((n) => n.type))].sort())
      const providers = new Set(nodes.flatMap((n) => {
        const p = (n.data as { provider?: unknown } | undefined)?.provider
        return typeof p === "string" ? [p] : []
      }))
      expect([...(t.providersUsed ?? [])].sort()).toEqual([...providers].sort())
    })
  })

  // The listing price of every built-in template (these three included) is
  // pinned in template-listing-prices.test.ts.
})
