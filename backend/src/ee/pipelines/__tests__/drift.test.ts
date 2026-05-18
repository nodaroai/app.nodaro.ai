import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../events.js", () => ({
  pipelineEvents: { publish: vi.fn() },
}))

import { validateCanvasAgainstPlan, getStageExpectedEntityIds } from "../drift.js"
import { pipelineEvents } from "../events.js"

beforeEach(() => {
  vi.clearAllMocks()
})

interface EntityFixture {
  id: string
  entity_key: string
  entity_type: string
  is_forked: boolean
}
interface NodeFixture {
  entity_id: string
  pipeline_state: string
}

function makeSupabaseMock(opts: {
  entities: EntityFixture[]
  nodes: NodeFixture[]
}) {
  return {
    from(table: string) {
      if (table === "pipeline_entities") {
        return {
          select: () => ({
            in: async () => ({ data: opts.entities, error: null }),
          }),
        }
      }
      if (table === "pipeline_entity_nodes") {
        return {
          select: () => ({
            in: async () => ({ data: opts.nodes, error: null }),
          }),
        }
      }
      throw new Error(`unmocked table: ${table}`)
    },
  } as never
}

describe("validateCanvasAgainstPlan", () => {
  it("returns ok=true and emits nothing when no entities are expected", async () => {
    const result = await validateCanvasAgainstPlan({} as never, "p1", [], "characters")
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.disconnected).toEqual([])
    expect(result.forked).toEqual([])
    expect(result.recommendedAction).toBe("none")
    expect(pipelineEvents.publish).not.toHaveBeenCalled()
  })

  it("detects missing entities (deleted off the canvas)", async () => {
    const supabase = makeSupabaseMock({ entities: [], nodes: [] })
    const result = await validateCanvasAgainstPlan(supabase, "p1", ["id-1", "id-2"], "characters")
    expect(result.ok).toBe(false)
    expect(result.missing).toHaveLength(2)
    expect(result.missing[0]).toMatchObject({ entityId: "id-1", entityKey: "(deleted)" })
    expect(result.recommendedAction).toBe("regenerate_missing")
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "pipeline:drift",
        pipelineId: "p1",
        stageName: "characters",
        driftedEntityIds: expect.arrayContaining(["id-1", "id-2"]),
      }),
    )
  })

  it("detects forked entities", async () => {
    const supabase = makeSupabaseMock({
      entities: [
        { id: "id-1", entity_key: "hero", entity_type: "character", is_forked: true },
      ],
      nodes: [],
    })
    const result = await validateCanvasAgainstPlan(supabase, "p1", ["id-1"], "scene_images")
    expect(result.ok).toBe(false)
    expect(result.forked).toHaveLength(1)
    expect(result.forked[0]).toMatchObject({ entityId: "id-1", entityKey: "hero" })
    expect(result.recommendedAction).toBe("fork_pipeline")
  })

  it("detects orphaned nodes (disconnected, not forked)", async () => {
    const supabase = makeSupabaseMock({
      entities: [
        { id: "id-1", entity_key: "carrier_deck", entity_type: "location", is_forked: false },
      ],
      nodes: [{ entity_id: "id-1", pipeline_state: "pipeline_orphaned" }],
    })
    const result = await validateCanvasAgainstPlan(supabase, "p1", ["id-1"], "shot_list")
    expect(result.ok).toBe(false)
    expect(result.disconnected).toHaveLength(1)
    expect(result.disconnected[0]).toMatchObject({ entityId: "id-1", entityKey: "carrier_deck" })
    expect(result.forked).toEqual([])
  })

  it("forked + orphaned overlap: counted as forked only (single root cause)", async () => {
    const supabase = makeSupabaseMock({
      entities: [
        { id: "id-1", entity_key: "hero", entity_type: "character", is_forked: true },
      ],
      // Same entity also has an orphaned node — fork already implies orphan,
      // so we count it under `forked` and skip `disconnected` to avoid
      // double-reporting the same root cause.
      nodes: [{ entity_id: "id-1", pipeline_state: "pipeline_orphaned" }],
    })
    const result = await validateCanvasAgainstPlan(supabase, "p1", ["id-1"], "characters")
    expect(result.ok).toBe(false)
    expect(result.forked).toHaveLength(1)
    expect(result.disconnected).toEqual([])
  })

  it("returns ok when entities are all present + non-forked + node is approved", async () => {
    const supabase = makeSupabaseMock({
      entities: [
        { id: "id-1", entity_key: "hero", entity_type: "character", is_forked: false },
      ],
      nodes: [{ entity_id: "id-1", pipeline_state: "pipeline_owned_approved" }],
    })
    const result = await validateCanvasAgainstPlan(supabase, "p1", ["id-1"], "characters")
    expect(result.ok).toBe(true)
    expect(pipelineEvents.publish).not.toHaveBeenCalled()
  })
})

describe("getStageExpectedEntityIds", () => {
  it("returns empty when no stages are completed yet", async () => {
    const supabase = {
      from(table: string) {
        if (table === "pipeline_stages") {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({ data: [], error: null }),
              }),
            }),
          }
        }
        throw new Error(`unmocked: ${table}`)
      },
    } as never
    const result = await getStageExpectedEntityIds(supabase, "p1")
    expect(result).toEqual([])
  })

  it("unions entities across every approved stage", async () => {
    const supabase = {
      from(table: string) {
        if (table === "pipeline_stages") {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [{ id: "stage-script" }, { id: "stage-characters" }],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === "pipeline_entities") {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [{ id: "ent-1" }, { id: "ent-2" }, { id: "ent-3" }],
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unmocked: ${table}`)
      },
    } as never
    const result = await getStageExpectedEntityIds(supabase, "p1")
    expect(result.sort()).toEqual(["ent-1", "ent-2", "ent-3"].sort())
  })
})
