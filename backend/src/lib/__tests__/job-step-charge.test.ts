// @test-reads-none a database double; reads no repo file
/**
 * R53: a job's charge as a run step = its own charge + its settled metered
 * side holds (554). Only a CONFIRMED (committed) side settle counts; nothing
 * is read without credits or before the schema; a failed read counts nothing
 * and never fails the run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  credits: true,
  ready: true,
  rows: [] as Array<{ job_id: string; usage_logs: Record<string, unknown> }>,
  error: null as { message: string } | null,
  reads: [] as Array<{ table: string; ids: unknown[]; filters: Array<[string, unknown]> }>,
}))
vi.mock("../config.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../config.js")>()), hasCredits: () => h.credits }))
vi.mock("../llm-metered-schema-gate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm-metered-schema-gate.js")>()),
  llmMeteredSchemaReady: () => h.ready,
}))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const read = { table, ids: [] as unknown[], filters: [] as Array<[string, unknown]> }
      h.reads.push(read)
      const q = {
        select: () => q,
        in: (_c: string, ids: unknown[]) => ((read.ids = ids), q),
        eq: (c: string, v: unknown) => (read.filters.push([c, v]), q),
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve(h.error ? { data: null, error: h.error } : { data: h.rows.filter((r) => read.ids.includes(r.job_id)), error: null }).then(res),
      }
      return q
    },
  },
}))

const { sideHoldChargesFor, withSideCharge, withSideHoldCharge } = await import("../job-step-charge.js")
const { creditsChargedOf } = await import("../job-credit-status.js")

beforeEach(() => {
  h.credits = true
  h.ready = true
  h.error = null
  h.reads = []
  h.rows = [
    { job_id: "clip-1", usage_logs: { status: "committed", credits_used: 4, credits_charged: 6 } },
    { job_id: "clip-1", usage_logs: { status: "committed", credits_used: 4, credits_charged: 3 } },
    { job_id: "clip-1", usage_logs: { status: "refunded", credits_used: 4, credits_charged: 0 } },
    { job_id: "clip-2", usage_logs: { status: "reserved", credits_used: 4, credits_charged: null } },
  ]
})

describe("sideHoldChargesFor", () => {
  it("sums each job's COMMITTED side-hold charges in one read (refunded and open holds add nothing)", async () => {
    const side = await sideHoldChargesFor(["clip-1", "clip-2", "clip-1", null, "other"])
    expect([...side]).toEqual([["clip-1", 9]])
    expect(h.reads).toHaveLength(1)
    expect(h.reads[0]).toMatchObject({ table: "llm_side_holds", ids: ["clip-1", "clip-2", "other"], filters: [["usage_logs.status", "committed"]] })
  })

  it("reads nothing without credits or before migration 554 is confirmed", async () => {
    h.credits = false
    expect((await sideHoldChargesFor(["clip-1"])).size).toBe(0)
    h.credits = true
    h.ready = false
    expect((await sideHoldChargesFor(["clip-1"])).size).toBe(0)
    expect(h.reads).toEqual([])
  })

  it("a failed read counts nothing (logged) and never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.error = { message: "timeout" }
    expect((await sideHoldChargesFor(["clip-1"])).size).toBe(0)
  })
})

describe("a step's charge", () => {
  it("own + side; an unknown own charge stays unknown when there is no side charge", async () => {
    const side = new Map([["clip-1", 9]])
    expect(withSideCharge(250, "clip-1", side)).toBe(259)
    expect(withSideCharge(undefined, "clip-1", side)).toBe(9)
    expect(withSideCharge(undefined, "img-1", side)).toBeUndefined()
    expect(withSideCharge(null, "img-1", side)).toBeNull()
    expect(await withSideHoldCharge({ jobId: "clip-1", creditsUsed: 250, output: {} })).toEqual({ jobId: "clip-1", creditsUsed: 259, output: {} })
    const plain = { jobId: "img-1", creditsUsed: 7 }
    expect(await withSideHoldCharge(plain)).toBe(plain)
  })

  it("the public credits_charged adds the side charge to a SETTLED own charge; an open hold stays null", () => {
    const side = new Map([["clip-1", 9]])
    const map = new Map([["ul-1", { status: "committed" as const, charged: 250 }], ["ul-2", { status: "reserved" as const, charged: null }]])
    expect(creditsChargedOf("ul-1", map, "clip-1", side)).toBe(259)
    expect(creditsChargedOf("ul-2", map, "clip-1", side)).toBeNull()
    expect(creditsChargedOf("ul-1", map, "img-1", side)).toBe(250)
  })
})
