/**
 * Every graph a use-case builder can emit is a graph the engine can run (the
 * use-case graph totality guard): every node type is registered, every edge
 * names real handles on real nodes, every data key is a field its type
 * declares (so the executor-reads guard and gen:skills see it), the outputMap
 * points at real output handles, and the graph is acyclic. Walks the whole
 * settings space. The canvas-legality half lives in the frontend
 * (tighten-episode-graph-connections.test.ts).
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
  UNIVERSAL_NODE_SETTINGS,
  buildTightenEpisodeGraph,
  resolveTightenEpisodeSettings,
  type UseCaseGraph,
} from "@nodaro/render-rules"
import { NODE_HANDLES } from "../mcp/generated/node-handles.js"

const FRAMINGS = [null, { aspect: "9:16", layout: "stacked" }, { aspect: "16:9", layout: "side-by-side" }, { aspect: "1:1", layout: "grid" }] as const

function* settingsSpace() {
  for (const kind of ["video", "audio"] as const)
    for (const output of ["video", "audio"] as const)
      for (const captions of [true, false])
        for (const reviewBeforeRender of [true, false])
          for (const planTier of ["economy", "standard", "premium"] as const)
            for (const music of [false, true])
              for (const durationSec of [undefined, 60, 3600])
                for (const framing of FRAMINGS)
                  yield { kind, music, durationSec, settings: resolveTightenEpisodeSettings({ ...TIGHTEN_EPISODE_DEFAULTS, output, captions, reviewBeforeRender, planTier, framing }, kind) }
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
    if (!NODE_HANDLES[n.type]) out.push(`unregistered type ${n.type}`)
    if (!Object.hasOwn(NODE_DATA_FIELDS, n.type) || !NODE_DATA_FIELDS[n.type]!.declared) out.push(`${n.type} has no declared data type`)
    const declared = declaredKeys(n.type)
    for (const key of Object.keys(n.data)) if (!declared.has(key)) out.push(`${n.type}.data.${key} is not a declared field`)
  }
  for (const e of g.edges) {
    const s = byId.get(e.source)
    const t = byId.get(e.target)
    if (!s || !t) {
      out.push(`edge ${e.id} names a missing node`)
      continue
    }
    if (!NODE_HANDLES[s.type]?.outputs.includes(e.sourceHandle)) out.push(`${s.type} has no output ${e.sourceHandle}`)
    if (!NODE_HANDLES[t.type]?.inputs.includes(e.targetHandle)) out.push(`${t.type} has no input ${e.targetHandle}`)
  }
  for (const ref of [g.outputMap.media, g.outputMap.preview, g.outputMap.json, g.outputMap.transcript]) {
    const n = byId.get(ref.nodeId)
    if (!n || !NODE_HANDLES[n.type]?.outputs.includes(ref.handle)) out.push(`outputMap → ${ref.nodeId}.${ref.handle} is not an output`)
  }
  if (!byId.has(g.outputMap.planNodeId) || !byId.has(g.outputMap.renderNodeId)) out.push("outputMap plan/render id missing")
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
