// @test-watches frontend/src/nodes/** backend/src/nodes/**
/**
 * A builder's `triesEvery` (decided 2026-10-18: the built nodes that try every
 * one of their kind, whichever one fails) names nodes its graph really has,
 * and a builder whose result is a list names every node that delivers one of
 * its items: a delivery node left out would stop its siblings on its first
 * failure, and an id no graph holds tries nothing.
 *
 * Read off the specs themselves (each builder's own resultKind and its built
 * graph's outputMap), never through a node type: a builder is checked from the
 * moment it has a spec. Each graph is built at its widest settings, with every
 * input its builder takes wired.
 */
import { describe, it, expect } from "vitest"
import {
  TIGHTEN_EPISODE_DEFAULTS,
  TRAILER_FORMATS,
  USE_CASE_NODE_TYPES,
  USE_CASE_SPECS,
  usecaseDescriptor,
  usecaseListsItsResult,
  type UseCaseBuilderKey,
  type UseCaseBuilderSpec,
  type UseCaseGraph,
  type UseCaseResultKind,
  type UseCaseSettings,
  type UseCaseSources,
} from "@nodaro/render-rules"

/** Each builder's widest settings: the most nodes it builds (every format, captions and framing on). */
const WIDEST: { readonly [K in UseCaseBuilderKey]: UseCaseSettings } = {
  tighten: { ...TIGHTEN_EPISODE_DEFAULTS, output: "video", captions: true, framing: { aspect: "9:16", layout: "stacked" } },
  chapters: {},
  trailer: { formats: [...TRAILER_FORMATS] },
}

/** Every input the builder takes, wired: the recording, and a music bed and an intro card where it has one. */
function everySource(spec: UseCaseBuilderSpec): UseCaseSources {
  return {
    media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 },
    ...(spec.inputNodeIds.music ? { music: { url: "https://r2/bed.mp3" } } : {}),
    ...(spec.inputNodeIds.introCard ? { introCard: { url: "https://r2/card.mp4", durationSec: 5 } } : {}),
  }
}

/** The built nodes that deliver a list kind's items; null for a kind whose result is not a list. */
function deliveryNodeIds(kind: UseCaseResultKind, graph: UseCaseGraph): readonly string[] | null {
  switch (kind) {
    case "episode":
    case "chapters":
      return null
    case "formats":
      if (graph.outputMap.kind !== "formats") throw new Error(`a formats builder built a ${graph.outputMap.kind ?? "episode"} map`)
      return graph.outputMap.formats.map((f) => f.ref.nodeId)
    case "clips":
      if (graph.outputMap.kind !== "clips") throw new Error(`a clips builder built a ${graph.outputMap.kind ?? "episode"} map`)
      return [graph.outputMap.media.nodeId]
    default: {
      const unknown: never = kind
      throw new Error(`no delivery rule for result kind ${String(unknown)}`)
    }
  }
}

const SPECS = Object.entries(USE_CASE_SPECS) as Array<[UseCaseBuilderKey, UseCaseBuilderSpec]>
const built = (key: UseCaseBuilderKey, spec: UseCaseBuilderSpec): UseCaseGraph =>
  spec.build(spec.resolveSettings(WIDEST[key], "video"), everySource(spec))

describe("a builder's triesEvery names its built nodes and covers every delivery of a list", () => {
  it("at least one builder tries every one of its kind (this guard checks something)", () => {
    expect(SPECS.some(([, spec]) => (spec.triesEvery?.length ?? 0) > 0)).toBe(true)
  })

  it("Trailer's widest settings build every format, after its intro card", () => {
    const graph = built("trailer", USE_CASE_SPECS.trailer)
    expect(deliveryNodeIds("formats", graph)).toHaveLength(TRAILER_FORMATS.length)
    expect(graph.nodes.some((n) => n.type === "combine-videos")).toBe(true)
  })

  for (const [key, spec] of SPECS) {
    it(`${key} (${spec.resultKind}): every triesEvery id is a node of its widest graph`, () => {
      const ids = new Set(built(key, spec).nodes.map((n) => n.id))
      for (const id of spec.triesEvery ?? []) expect(ids.has(id), `${key}: "${id}"`).toBe(true)
    })

    it(`${key} (${spec.resultKind}): a list names every node that delivers one of its items`, () => {
      const deliveries = deliveryNodeIds(spec.resultKind, built(key, spec))
      if (deliveries === null) return
      expect(deliveries.length, key).toBeGreaterThan(0)
      expect(spec.triesEvery ?? [], key).toEqual(expect.arrayContaining([...deliveries]))
    })
  }

  // The kinds this guard calls a list are the ones a node's own result lists (the fan-out and saved-list readers).
  for (const type of USE_CASE_NODE_TYPES) {
    it(`${type}: its result is a list exactly where this guard reads deliveries`, () => {
      const d = usecaseDescriptor(type)
      const deliveries = deliveryNodeIds(d.resultKind, d.build(d.resolveSettings({}, "video"), everySource(d)))
      expect(deliveries !== null, type).toBe(usecaseListsItsResult(type))
    })
  }
})
