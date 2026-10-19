/**
 * Every graph a use-case builder can emit is a graph the engine can run (the
 * use-case graph totality guard): every node type is registered, every edge
 * names real handles on real nodes, every data key is a field its type
 * declares (so the executor-reads guard and gen:skills see it), the outputMap
 * points at real output handles, and the graph is acyclic. Walks the whole
 * settings space of every registered use-case type (`SETTINGS_TABLES`: one
 * table per type, built through its registry descriptor). A built wire's data
 * is absent or exactly `{ outputMode: "each" }`. The canvas-legality half
 * lives in the frontend (tighten-episode-graph-connections.test.ts).
 *
 * Declared = the type's `NODE_DATA_FIELDS` (its data type's fields, generated
 * by gen:skills) ∪ `UNIVERSAL_NODE_SETTINGS` ∪ its `EXTRA_NODE_SETTINGS`. Not
 * `nodeSettingKeys`: that leaves out what a node holds (an upload's url, asset
 * and file facts), which a built source node must carry for the run to read.
 */
import { describe, it, expect } from "vitest"
import {
  EXTRA_NODE_SETTINGS,
  NODE_DATA_FIELDS,
  TIGHTEN_EPISODE_DEFAULTS,
  TRAILER_FORMATS,
  UNIVERSAL_NODE_SETTINGS,
  USE_CASE_NODE_TYPES,
  buildTightenEpisodeGraph,
  resolveTightenEpisodeSettings,
  usecaseDescriptor,
  usecaseRenderNodeId,
  type UseCaseGraph,
  type UseCaseHandleRef,
  type UseCaseMediaKind,
  type UseCaseNodeType,
  type UseCaseSettings,
  type UseCaseSources,
} from "@nodaro/render-rules"
import { EDIT_PLAN_TIERS } from "@nodaro/shared/edl"
import { ALL_NODE_HANDLES } from "../node-handles.js"

const FRAMINGS = [null, { aspect: "9:16", layout: "stacked" }, { aspect: "16:9", layout: "side-by-side" }, { aspect: "1:1", layout: "grid" }] as const

function* settingsSpace() {
  for (const kind of ["video", "audio"] as const)
    for (const output of ["video", "audio"] as const)
      for (const captions of [true, false])
        for (const reviewBeforeRender of [true, false])
          for (const planTier of ["economy", "standard", "premium"] as const)
            for (const music of [false, true])
              for (const durationSec of [undefined, 60, 3600])
                for (const framing of FRAMINGS) {
                  const raw = { ...TIGHTEN_EPISODE_DEFAULTS, output, captions, reviewBeforeRender, planTier, framing }
                  yield { kind, music, durationSec, raw, settings: resolveTightenEpisodeSettings(raw, kind) }
                }
}

type SettingsCase = { readonly raw: UseCaseSettings; readonly kind: UseCaseMediaKind; readonly sources: UseCaseSources }

/** One settings table per registered use-case type: the raw settings and inputs its builder is walked over. */
const SETTINGS_TABLES: Record<UseCaseNodeType, () => Iterable<SettingsCase>> = {
  "tighten-episode": function* () {
    for (const c of settingsSpace()) {
      yield {
        raw: c.raw,
        kind: c.kind,
        sources: {
          media: { url: "https://r2/ep", kind: c.kind, ...(c.durationSec ? { durationSec: c.durationSec } : {}) },
          ...(c.music ? { music: { url: "https://r2/bed.mp3" } } : {}),
        },
      }
    }
  },
  "episode-chapters": function* () {
    for (const kind of ["video", "audio"] as const)
      for (const planTier of EDIT_PLAN_TIERS)
        for (const durationSec of [undefined, 60, 3600])
          for (const instructions of ["", "Short titles"])
            for (const styleGuide of ["", "Sentence case"]) {
              yield {
                raw: { planTier, instructions, styleGuide },
                kind,
                sources: { media: { url: "https://r2/ep", kind, ...(durationSec ? { durationSec } : {}) } },
              }
            }
  },
  // Video only (an audio-only recording is refused before anything is built).
  "episode-trailer": function* () {
    for (const formats of [["9:16"], ["9:16", "1:1", "4:5"], [...TRAILER_FORMATS]])
      for (const reviewBeforeRender of [false, true])
        for (const introCard of [undefined, { url: "https://r2/card.mp4" }, { url: "https://r2/card.mp4", durationSec: 6 }])
          for (const durationSec of [undefined, 3600]) {
            yield {
              raw: { formats, reviewBeforeRender },
              kind: "video",
              sources: {
                media: { url: "https://r2/ep", kind: "video", ...(durationSec ? { durationSec } : {}) },
                ...(introCard ? { introCard } : {}),
              },
            }
          }
  },
  // An audio recording makes audio clips: no framing, no captions (the resolver forces both).
  "clip-pack": function* () {
    for (const kind of ["video", "audio"] as const)
      for (const captions of [true, false])
        for (const framing of [null, undefined, { aspect: "1:1", layout: "side-by-side" }])
          for (const reviewBeforeRender of [false, true])
            for (const count of [1, 8, 50])
              for (const durationSec of [undefined, 3600]) {
                yield {
                  raw: { captions, reviewBeforeRender, count, ...(framing !== undefined ? { framing } : {}) },
                  kind,
                  sources: { media: { url: "https://r2/ep", kind, ...(durationSec ? { durationSec } : {}) } },
                }
              }
  },
}

/** Every graph `type`'s descriptor builds over its settings table, with the case it was built from. */
function* graphsOf(type: UseCaseNodeType): Generator<{ readonly c: SettingsCase; readonly g: UseCaseGraph }> {
  const d = usecaseDescriptor(type)
  for (const c of SETTINGS_TABLES[type]()) yield { c, g: d.build(d.resolveSettings(c.raw, c.kind), c.sources) }
}

/** Every handle ref of the output map: its plan, transcript, and (a rendering graph) its preview and deliveries. */
function outputRefsOf(g: UseCaseGraph): UseCaseHandleRef[] {
  const m = g.outputMap
  if (m.kind === "chapters") return [m.json, m.transcript]
  const delivered = m.kind === "formats" ? m.formats.map((f) => f.ref) : [m.media]
  return [...delivered, m.preview, m.json, m.transcript]
}

function declaredKeys(type: string): ReadonlySet<string> {
  const fields = Object.hasOwn(NODE_DATA_FIELDS, type) ? NODE_DATA_FIELDS[type]!.fields : []
  const extra = Object.hasOwn(EXTRA_NODE_SETTINGS, type) ? EXTRA_NODE_SETTINGS[type]! : []
  return new Set([...fields, ...UNIVERSAL_NODE_SETTINGS, ...extra])
}

function problems(g: UseCaseGraph): string[] {
  const out: string[] = []
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  if (byId.size !== g.nodes.length) out.push("duplicate node id")
  if (new Set(g.edges.map((e) => e.id)).size !== g.edges.length) out.push("duplicate edge id")
  for (const n of g.nodes) {
    if (!ALL_NODE_HANDLES[n.type]) out.push(`unregistered type ${n.type}`)
    if (!Object.hasOwn(NODE_DATA_FIELDS, n.type) || !NODE_DATA_FIELDS[n.type]!.declared) out.push(`${n.type} has no declared data type`)
    const declared = declaredKeys(n.type)
    for (const key of Object.keys(n.data)) if (!declared.has(key)) out.push(`${n.type}.data.${key} is not a declared field`)
  }
  for (const e of g.edges) {
    if (e.data !== undefined && JSON.stringify(e.data) !== JSON.stringify({ outputMode: "each" })) {
      out.push(`edge ${e.id} has data ${JSON.stringify(e.data)}`)
    }
    const s = byId.get(e.source)
    const t = byId.get(e.target)
    if (!s || !t) {
      out.push(`edge ${e.id} names a missing node`)
      continue
    }
    if (!ALL_NODE_HANDLES[s.type]?.outputs.includes(e.sourceHandle)) out.push(`${s.type} has no output ${e.sourceHandle}`)
    if (!ALL_NODE_HANDLES[t.type]?.inputs.includes(e.targetHandle)) out.push(`${t.type} has no input ${e.targetHandle}`)
  }
  for (const ref of outputRefsOf(g)) {
    const n = byId.get(ref.nodeId)
    if (!n || !ALL_NODE_HANDLES[n.type]?.outputs.includes(ref.handle)) out.push(`outputMap → ${ref.nodeId}.${ref.handle} is not an output`)
  }
  const renderId = usecaseRenderNodeId(g.outputMap)
  if (!byId.has(g.outputMap.planNodeId) || (renderId !== null && !byId.has(renderId))) out.push("outputMap plan/render id missing")
  // Kahn: acyclic
  const indeg = new Map(g.nodes.map((n) => [n.id, 0]))
  for (const e of g.edges) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id)
  let seen = 0
  while (queue.length) {
    const id = queue.shift()!
    seen++
    for (const e of g.edges.filter((x) => x.source === id)) {
      const d = (indeg.get(e.target) ?? 0) - 1
      indeg.set(e.target, d)
      if (d === 0) queue.push(e.target)
    }
  }
  if (seen !== g.nodes.length) out.push("cycle")
  return out
}

describe("use-case graphs are runnable graphs (every setting combination)", () => {
  it("Tighten Episode", () => {
    let count = 0
    for (const c of settingsSpace()) {
      const g = buildTightenEpisodeGraph(c.settings, {
        media: { url: "https://r2/ep", kind: c.kind, ...(c.durationSec ? { durationSec: c.durationSec } : {}) },
        ...(c.music ? { music: { url: "https://r2/bed.mp3" } } : {}),
      })
      expect(problems(g), JSON.stringify({ ...c, settings: undefined })).toEqual([])
      count++
    }
    expect(count).toBe(1152)
  })

  it("has a settings table for every registered use-case type", () => {
    expect(Object.keys(SETTINGS_TABLES).sort()).toEqual([...USE_CASE_NODE_TYPES].sort())
  })

  for (const type of USE_CASE_NODE_TYPES) {
    it(`${type}, built through its registry descriptor`, () => {
      let count = 0
      for (const { c, g } of graphsOf(type)) {
        expect(g.nodeType).toBe(type)
        expect(problems(g), JSON.stringify({ raw: c.raw, kind: c.kind, sources: c.sources })).toEqual([])
        count++
      }
      expect(count).toBeGreaterThan(0)
    })
  }

  it("the guard catches a wire whose data is not exactly an Each mode", () => {
    const g = buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep", kind: "video" } })
    const each: UseCaseGraph = { ...g, edges: g.edges.map((e, i) => (i === 0 ? { ...e, data: { outputMode: "each" } } : e)) }
    expect(problems(each)).toEqual([])
    const last = { ...g, edges: g.edges.map((e, i) => (i === 0 ? { ...e, data: { outputMode: "last" } } : e)) } as unknown as UseCaseGraph
    expect(problems(last)).toEqual([`edge ${g.edges[0]!.id} has data {"outputMode":"last"}`])
  })

  it("the guard itself catches an undeclared key, a wrong handle and a cycle", () => {
    const g = buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep", kind: "video" } })
    const broken: UseCaseGraph = {
      ...g,
      nodes: g.nodes.map((n) => (n.id === g.outputMap.planNodeId ? { ...n, data: { ...n.data, executionStatus: "idle", notAField: 1 } } : n)),
      edges: [
        ...g.edges,
        { id: "x1", source: g.outputMap.renderNodeId, target: g.outputMap.planNodeId, sourceHandle: "media", targetHandle: "nope" },
      ],
    }
    expect(problems(broken)).toEqual(
      expect.arrayContaining(["edit-plan.data.notAField is not a declared field", "edit-plan has no input nope", "cycle"]),
    )
  })
})
