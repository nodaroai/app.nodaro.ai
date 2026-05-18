import { describe, it, expect, vi } from "vitest"
import {
  resolveEntityKeysToIds,
  setEntityDepends,
  markEntityNodeState,
  orphanAllEntityNodes,
} from "../depends-on.js"

describe("resolveEntityKeysToIds", () => {
  it("returns empty array for empty keys and never touches supabase", async () => {
    const supabase = { from: vi.fn() } as never
    const result = await resolveEntityKeysToIds(supabase, "p1", [])
    expect(result).toEqual([])
    expect((supabase as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled()
  })

  it("resolves keys to ids via pipeline_entities lookup", async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            in: async () => ({
              data: [
                { id: "id-a", entity_key: "hero" },
                { id: "id-b", entity_key: "carrier" },
              ],
              error: null,
            }),
          }),
        }),
      })),
    } as never
    const result = await resolveEntityKeysToIds(supabase, "p1", ["hero", "carrier"])
    expect(result.sort()).toEqual(["id-a", "id-b"].sort())
  })

  it("throws when the underlying supabase query errors", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({ data: null, error: { message: "db down" } }),
          }),
        }),
      }),
    } as never
    await expect(
      resolveEntityKeysToIds(supabase, "p1", ["hero"]),
    ).rejects.toThrow(/resolveEntityKeysToIds: db down/)
  })
})

describe("setEntityDepends", () => {
  it("writes depends_on array", async () => {
    const update = vi.fn(() => ({ eq: async () => ({ error: null }) }))
    const supabase = { from: () => ({ update }) } as never
    await setEntityDepends(supabase, "ent-1", ["dep-1", "dep-2"])
    expect(update).toHaveBeenCalledWith({ depends_on: ["dep-1", "dep-2"] })
  })

  it("throws when the update errors", async () => {
    const supabase = {
      from: () => ({
        update: () => ({
          eq: async () => ({ error: { message: "boom" } }),
        }),
      }),
    } as never
    await expect(setEntityDepends(supabase, "ent-1", [])).rejects.toThrow(
      /setEntityDepends ent-1: boom/,
    )
  })
})

describe("markEntityNodeState", () => {
  it("writes pipeline_state and last_state_change_at", async () => {
    const updateCalls: Array<Record<string, unknown>> = []
    const update = vi.fn((payload: Record<string, unknown>) => {
      updateCalls.push(payload)
      return { eq: async () => ({ error: null }) }
    })
    const supabase = { from: () => ({ update }) } as never
    await markEntityNodeState(supabase, "ent-1", "pipeline_owned_approved")
    expect(updateCalls).toHaveLength(1)
    const arg = updateCalls[0] as Record<string, unknown>
    expect(arg.pipeline_state).toBe("pipeline_owned_approved")
    expect(typeof arg.last_state_change_at).toBe("string")
    // ISO-8601 sanity check.
    expect(Date.parse(arg.last_state_change_at as string)).not.toBeNaN()
  })

  it("throws when the update errors", async () => {
    const supabase = {
      from: () => ({
        update: () => ({
          eq: async () => ({ error: { message: "nope" } }),
        }),
      }),
    } as never
    await expect(
      markEntityNodeState(supabase, "ent-1", "pipeline_orphaned"),
    ).rejects.toThrow(/markEntityNodeState ent-1: nope/)
  })
})

describe("orphanAllEntityNodes", () => {
  it("loads entity ids then updates pipeline_entity_nodes with .in()", async () => {
    const updateInArgs: Array<{ col: string; ids: string[] }> = []
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "pipeline_entities") {
          return {
            select: () => ({
              eq: async () => ({
                data: [{ id: "ent-1" }, { id: "ent-2" }],
                error: null,
              }),
            }),
          }
        }
        if (table === "pipeline_entity_nodes") {
          return {
            update: () => ({
              in: async (col: string, ids: string[]) => {
                updateInArgs.push({ col, ids })
                return { error: null }
              },
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    } as never
    await orphanAllEntityNodes(supabase, "p1")
    expect(updateInArgs).toHaveLength(1)
    expect(updateInArgs[0]?.col).toBe("entity_id")
    expect(updateInArgs[0]?.ids.sort()).toEqual(["ent-1", "ent-2"].sort())
  })

  it("no-ops when the pipeline has no entities", async () => {
    const updateSpy = vi.fn()
    const supabase = {
      from: (table: string) => {
        if (table === "pipeline_entities") {
          return {
            select: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          }
        }
        // Should not be called.
        updateSpy()
        return { update: () => ({ in: async () => ({ error: null }) }) }
      },
    } as never
    await orphanAllEntityNodes(supabase, "p1")
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it("throws (not silently no-op) when the entity-id lookup fails", async () => {
    const supabase = {
      from: (table: string) => {
        if (table === "pipeline_entities") {
          return {
            select: () => ({
              eq: async () => ({ data: null, error: { message: "db read fail" } }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    } as never
    await expect(orphanAllEntityNodes(supabase, "p1")).rejects.toThrow(
      /orphanAllEntityNodes p1: failed to load entity ids: db read fail/,
    )
  })
})
