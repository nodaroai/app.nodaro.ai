/**
 * A trend person mask's own job, idle (lib/reconcile/trend-variant-anchor-sweep.ts):
 * closed only after a day with nobody advancing it, and never while its
 * child erase runs; an advance touches its clock.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { has, type QueryResult, type RecordedQuery } from "../../__tests__/fake-supabase-query.js"

const db = vi.hoisted(() => ({ log: [] as RecordedQuery[], respond: null as null | ((q: RecordedQuery) => QueryResult) }))
vi.mock("../../supabase.js", async () => {
  const { makeFakeFrom: make } = await import("../../__tests__/fake-supabase-query.js")
  return { supabase: { from: make(db.log, (q) => db.respond!(q)) } }
})
const failed = vi.hoisted(() => [] as Array<{ id: string; message: string; from?: string[] }>)
vi.mock("../../job-failure.js", () => ({
  markJobFailed: vi.fn(async (id: string, input: { error_message: string; from?: string[] }) => {
    failed.push({ id, message: input.error_message, from: input.from })
    return true
  }),
}))

import {
  TREND_VARIANT_ANCHOR_IDLE_MS,
  TREND_VARIANT_ANCHOR_TYPE,
  sweepIdleTrendVariantAnchors,
  touchTrendVariantAnchor,
} from "../trend-variant-anchor-sweep.js"

const result = () => ({ scanned: 0, swept: 0, recovered: 0, notStale: 0, errors: 0 })

beforeEach(() => {
  db.log.length = 0
  failed.length = 0
})

describe("sweepIdleTrendVariantAnchors", () => {
  it("looks only at processing person-mask jobs untouched for a day", async () => {
    db.respond = () => ({ data: [], error: null })
    const before = Date.now()
    await sweepIdleTrendVariantAnchors(result())
    const q = db.log[0]!
    expect(has(q, "eq", "status", "processing")).toBe(true)
    expect(has(q, "eq", "input_data->>type", TREND_VARIANT_ANCHOR_TYPE)).toBe(true)
    const cutoff = Date.parse(q.ops.find((op) => op.m === "lt")!.a[1] as string)
    expect(before - cutoff).toBeGreaterThanOrEqual(TREND_VARIANT_ANCHOR_IDLE_MS - 1000)
    expect(TREND_VARIANT_ANCHOR_IDLE_MS).toBe(24 * 60 * 60_000)
  })

  it("closes an idle one, and leaves one whose child erase is still running", async () => {
    db.respond = (q) => {
      if (q.ops.some((op) => op.m === "eq" && op.a[0] === "parent_job_id")) {
        const parent = q.ops.find((op) => op.a[0] === "parent_job_id")!.a[1]
        return { data: parent === "busy" ? [{ id: "erase" }] : [], error: null }
      }
      return { data: [{ id: "idle", user_id: "u1" }, { id: "busy", user_id: "u1" }], error: null }
    }
    const r = result()
    await sweepIdleTrendVariantAnchors(r)
    expect(failed.map((f) => f.id)).toEqual(["idle"])
    expect(failed[0]!.from).toEqual(["processing"])
    expect(r).toMatchObject({ scanned: 2, swept: 1, notStale: 1 })
    // The children are read as the anchor's owner's.
    expect(db.log.filter((q) => has(q, "eq", "parent_job_id", "busy")).every((q) => has(q, "eq", "user_id", "u1"))).toBe(true)
  })
})

describe("touchTrendVariantAnchor", () => {
  it("moves the idle clock of a processing anchor only", async () => {
    db.respond = () => ({ data: null, error: null })
    await touchTrendVariantAnchor("a1")
    const q = db.log[0]!
    expect(q.ops.find((op) => op.m === "update")!.a[0]).toEqual({ started_at: expect.any(String) })
    expect(has(q, "eq", "id", "a1")).toBe(true)
    expect(has(q, "eq", "status", "processing")).toBe(true)
  })
})
