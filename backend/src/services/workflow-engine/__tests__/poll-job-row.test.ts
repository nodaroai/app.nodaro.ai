// @test-reads-none a stubbed database; reads no repo file
// The node poll's read names two columns that may not be in the shared
// database yet (`slot_wait_ms`, `lane_wait_ms`). Each is dropped — and
// remembered as absent — only when it is the one missing: a missing lane
// column never stops the slot wait being read, nor the other way round.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  missing: new Set<string>(),
  /** Name the missing column in the error message (Postgres does; assume nothing). */
  named: true,
  selects: [] as string[],
}))

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => {
      let cols = ""
      const b = {
        select: (c: string) => { cols = c; h.selects.push(c); return b },
        eq: () => b,
        single: async () => {
          const gone = [...h.missing].find((c) => cols.includes(c))
          if (gone) return { data: null, error: { code: "42703", message: h.named ? `column jobs.${gone} does not exist` : "column does not exist" } }
          return { data: { status: "processing" }, error: null }
        },
      }
      return b
    },
  },
}))

const { readPollJobRow } = await import("../poll-job-row.js")
const { resetSlotWaitColumnForTests, slotWaitColumnAbsent } = await import("../../../lib/jobs-slot-wait-column.js")
const { laneColumnsAbsent, resetLaneColumnsForTests } = await import("../../../lib/concurrency-lanes/columns.js")

beforeEach(() => {
  h.missing.clear()
  h.named = true
  h.selects.length = 0
  resetSlotWaitColumnForTests()
  resetLaneColumnsForTests()
})
afterEach(() => vi.restoreAllMocks())

const read = () => readPollJobRow<{ status: string }>("job-1", "status")

describe("readPollJobRow", () => {
  it("with both columns in the database: one read naming both", async () => {
    await expect(read()).resolves.toEqual({ data: { status: "processing" }, error: null })
    expect(h.selects).toEqual(["status, slot_wait_ms, lane_wait_ms"])
  })

  for (const named of [true, false]) {
    describe(named ? "an error that names the column" : "an error that names no column", () => {
      beforeEach(() => { h.named = named })

      it("a missing lane column is dropped alone: the slot wait is still read", async () => {
        h.missing.add("lane_wait_ms")
        await expect(read()).resolves.toMatchObject({ data: { status: "processing" } })
        expect(laneColumnsAbsent("jobs")).toBe(true)
        expect(slotWaitColumnAbsent()).toBe(false)
        expect(h.selects.at(-1)).toBe("status, slot_wait_ms")
        h.selects.length = 0
        await read()
        expect(h.selects).toEqual(["status, slot_wait_ms"])
      })

      it("a missing slot column is dropped alone: the lane wait is still read", async () => {
        h.missing.add("slot_wait_ms")
        await expect(read()).resolves.toMatchObject({ data: { status: "processing" } })
        expect(slotWaitColumnAbsent()).toBe(true)
        expect(laneColumnsAbsent("jobs")).toBe(false)
        expect(h.selects.at(-1)).toBe("status, lane_wait_ms")
      })

      it("both missing: both dropped, the row still read", async () => {
        h.missing.add("slot_wait_ms").add("lane_wait_ms")
        await expect(read()).resolves.toMatchObject({ data: { status: "processing" } })
        expect(slotWaitColumnAbsent()).toBe(true)
        expect(laneColumnsAbsent("jobs")).toBe(true)
        expect(h.selects.at(-1)).toBe("status")
      })
    })
  }
})
