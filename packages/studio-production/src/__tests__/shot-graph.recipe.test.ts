import { describe, it, expect } from "vitest"

import type { Shot, ShotRecipe } from "../shot"
import {
  parseProduction,
  serializeProduction,
  studioIndexExpectsShots,
  type SerializedProduction,
} from "../shot-graph"
import type { WorkflowLike as Workflow } from "../workflow-like"

/**
 * `Shot.recipe` round-trip — the recipe-only bundle contract (portability spec
 * 2026-08-31 §3): a shot imported "without media" carries its regeneration
 * inputs in `recipe`, has NO still/clip, and must survive serialize → parse as
 * a NODE-LESS placeholder entry. A claimed-but-missing node id would drop the
 * entry on parse (`shot-graph`'s lost-entry rule), so the serializer writing no
 * node ids for it is load-bearing, not incidental.
 */

/** Wrap a serialized graph as the Workflow shape `parseProduction` consumes. */
const asWorkflow = (graph: SerializedProduction): Workflow =>
  ({
    id: "wf-test",
    nodes: graph.nodes,
    edges: graph.edges,
    settings: graph.settings,
  }) as unknown as Workflow

const RECIPE: ShotRecipe = {
  framing: {
    prompt: "a lighthouse at dusk",
    provider: "nano-banana",
    negativePrompt: "text, watermark",
    aspectRatio: "16:9",
    resolution: "2K",
  },
  directing: {
    prompt: "slow push-in as the beam sweeps",
    provider: "grok-i2v",
    duration: 5,
    directions: [{ kind: "sfx", text: "waves crashing" }],
  },
  voice: { text: "It began at the lighthouse.", voiceId: "v1" },
}

const recipeOnly = (id: string): Shot => ({ id, name: "Opening", recipe: RECIPE })

const stillShot = (id: string): Shot => ({
  id,
  still: {
    nodeId: `generate-image-${id}`,
    url: `https://r2.example/${id}.png`,
    provider: "nano-banana",
    prompt: `prompt ${id}`,
  },
})

describe("shot-graph — Shot.recipe round-trip (recipe-only bundles)", () => {
  it("round-trips a recipe-only shot as a node-less placeholder entry", () => {
    const graph = serializeProduction([recipeOnly("r1"), stillShot("s1")], "r1")

    // No node and no node ids for the recipe shot — a claimed node id would
    // classify the entry as LOST on parse and drop it.
    const entry = graph.settings.studio.shots[0]!
    expect(entry.imageNodeId).toBeUndefined()
    expect(entry.videoNodeId).toBeUndefined()
    expect(graph.nodes.some((n) => n.id.includes("r1"))).toBe(false)
    expect(entry.recipe).toEqual(RECIPE)

    const { shots } = parseProduction(asWorkflow(graph))
    expect(shots).toHaveLength(2)
    expect(shots[0]).toMatchObject({ id: "r1", name: "Opening", recipe: RECIPE })
    expect(shots[0]!.still).toBeUndefined()
    expect(shots[0]!.clip).toBeUndefined()
  })

  it("keeps every recipe field verbatim through serialize → parse", () => {
    const graph = serializeProduction([recipeOnly("r1")], "r1")
    const reparsed = parseProduction(asWorkflow(graph)).shots[0]!
    expect(reparsed.recipe).toEqual(RECIPE)
  })

  it("a recipe-only index does not claim node-backed shots (hydrate guard accepts it)", () => {
    const graph = serializeProduction([recipeOnly("r1"), recipeOnly("r2")], "r1")
    expect(studioIndexExpectsShots(asWorkflow(graph))).toBe(false)
  })

  it("serialize copies the recipe (no aliasing of the store objects)", () => {
    const shot = recipeOnly("r1")
    const graph = serializeProduction([shot], "r1")
    const entry = graph.settings.studio.shots[0]!
    expect(entry.recipe).not.toBe(shot.recipe)
    expect(entry.recipe?.framing).not.toBe(shot.recipe?.framing)
    expect(entry.recipe?.directing?.directions?.[0]).not.toBe(
      shot.recipe?.directing?.directions?.[0],
    )
  })

  it("drops an unusable recipe blob instead of resurrecting garbage", () => {
    const graph = serializeProduction([recipeOnly("r1")], "r1")
    const studio = graph.settings.studio
    const corrupted = {
      ...graph,
      settings: {
        studio: {
          ...studio,
          shots: [{ ...studio.shots[0]!, recipe: { framing: { prompt: 42 } } }],
        },
      },
    } as unknown as SerializedProduction
    const { shots } = parseProduction(asWorkflow(corrupted))
    expect(shots).toHaveLength(1) // still a valid placeholder…
    expect(shots[0]!.recipe).toBeUndefined() // …just without the garbage
  })

  it("a shot without a recipe serializes without the key (byte-identical saves)", () => {
    const graph = serializeProduction([stillShot("s1")], "s1")
    expect("recipe" in graph.settings.studio.shots[0]!).toBe(false)
  })
})
