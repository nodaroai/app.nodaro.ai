/**
 * The podcast pack sweep (lib/reconcile/podcast-pack-sweep.ts): a pack left
 * `processing` is closed by what became of its tools — a tool run names it:
 * completed and charged; none does: failed and refunded; its runs unreadable:
 * left for the next tick.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  packs: [] as Array<Record<string, unknown>>,
  runs: [] as Array<Record<string, unknown>>,
  runsError: null as unknown,
  filters: [] as Array<[string, unknown]>,
  failed: [] as unknown[][],
  completed: [] as Array<[string, Record<string, unknown>]>,
  committed: [] as string[],
  refunded: [] as string[],
}))

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: () => {
      let wrappers = false
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn(() => chain)
      chain.eq = vi.fn((col: string, val: unknown) => {
        if (col.startsWith("input_data->>")) wrappers = true
        m.filters.push([col, val])
        return chain
      })
      chain.lt = vi.fn(() => chain)
      chain.limit = vi.fn(async () => (wrappers ? { data: m.runs, error: m.runsError } : { data: m.packs, error: null }))
      return chain
    },
  },
}))
vi.mock("../../job-failure.js", () => ({ markJobFailed: async (...a: unknown[]) => (m.failed.push(a), true) }))
vi.mock("../../credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: async (id: string) => void m.committed.push(id),
  refundReservedCreditsForJob: async (id: string) => (m.refunded.push(id), 1),
}))
vi.mock("../../../workers/shared.js", () => ({
  markJobCompleted: async (id: string, fields: Record<string, unknown>) => (m.completed.push([id, fields]), true),
}))

const { sweepPodcastPacks } = await import("../podcast-pack-sweep.js")

beforeEach(() => {
  Object.assign(m, { packs: [{ id: "pack-1", user_id: "user-1", input_data: { units: 35, durationSec: 512 } }], runs: [], runsError: null, filters: [], failed: [], completed: [], committed: [], refunded: [] })
})

describe("sweepPodcastPacks", () => {
  it("a tool started: the pack is charged and completed, listing its runs", async () => {
    m.runs = [{ id: "wrap-1", job_type: "clip-pack" }]
    const result = await sweepPodcastPacks()
    expect(m.committed).toEqual(["pack-1"])
    expect(m.completed[0]![1].output_data).toEqual({ tools: [{ tool: "clip-pack", jobId: "wrap-1", executionId: null }], durationSec: 512, units: 35 })
    expect(m.refunded).toEqual([])
    expect(result.swept).toBe(1)
    // Its runs are read owner-scoped, by the pack they name.
    expect(m.filters).toEqual(expect.arrayContaining([["user_id", "user-1"], ["input_data->>_coveredBy", "pack-1"]]))
  })

  it("no tool started: the pack fails and its hold is returned", async () => {
    await sweepPodcastPacks()
    expect(m.failed).toHaveLength(1)
    expect(m.refunded).toEqual(["pack-1"])
    expect(m.committed).toEqual([])
  })

  it("its runs cannot be read: left for the next tick", async () => {
    m.runsError = { message: "boom" }
    const result = await sweepPodcastPacks()
    expect(result.errors).toBe(1)
    expect(m.failed).toEqual([])
    expect(m.refunded).toEqual([])
    expect(m.committed).toEqual([])
  })
})
