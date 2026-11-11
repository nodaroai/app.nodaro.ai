/**
 * The claim that holds one house-model `start` per job (lib/house-model-claim.ts):
 * the compare-and-set's exact write and filters, what a failed claim reads
 * back, and the save that replaces the claim with the run's reference.
 * Against a FAKE supabase chain that records every call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; args: unknown[] }>,
  /** Answers, in order, of each awaited chain. */
  answers: [] as Array<{ data: unknown; error: { message: string } | null }>,
}))

vi.mock("@/lib/supabase.js", () => {
  const chain = (table: string): Record<string, unknown> => {
    const self: Record<string, unknown> = {}
    for (const op of ["update", "select", "eq", "is", "in", "maybeSingle"]) {
      self[op] = (...args: unknown[]) => {
        db.calls.push({ table, op, args })
        return self
      }
    }
    self.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(db.answers.shift() ?? { data: null, error: null }).then(resolve, reject)
    return self
  }
  return { supabase: { from: (table: string) => chain(table) } }
})

import { HOUSE_MODEL_CLAIM_REF, claimHouseModelStart, isHouseModelReference, saveHouseModelReference } from "../house-model-claim.js"

beforeEach(() => {
  db.calls = []
  db.answers = []
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

const ops = () => db.calls.map((c) => [c.op, ...c.args])

describe("claimHouseModelStart", () => {
  it("is one compare-and-set: kind house-model, the claim as task id, a fresh stamp — only on a live row with no task id", async () => {
    db.answers.push({ data: [{ id: "job-1" }], error: null })
    await expect(claimHouseModelStart("job-1")).resolves.toEqual({ state: "claimed" })
    const [update, ...filters] = ops()
    expect(update![0]).toBe("update")
    const written = update![1] as Record<string, unknown>
    expect(written).toMatchObject({ provider_kind: "house-model", provider_task_id: HOUSE_MODEL_CLAIM_REF })
    expect(typeof written.provider_call_started_at).toBe("string")
    expect(filters).toContainEqual(["eq", "id", "job-1"])
    expect(filters).toContainEqual(["is", "provider_task_id", null])
    // Live, never parked on a reviewer, never terminal.
    expect(filters).toContainEqual(["in", "status", ["pending", "queued", "processing"]])
  })

  it("a lost claim reads the row: this run's reference is read back, anything else is taken", async () => {
    db.answers.push({ data: [], error: null }, { data: { provider_kind: "house-model", provider_task_id: "ref-9" }, error: null })
    await expect(claimHouseModelStart("job-1")).resolves.toEqual({ state: "started", taskRef: "ref-9" })
    db.answers.push({ data: [], error: null }, { data: { provider_kind: "house-model", provider_task_id: HOUSE_MODEL_CLAIM_REF }, error: null })
    await expect(claimHouseModelStart("job-1")).resolves.toEqual({ state: "taken" })
    db.answers.push({ data: [], error: null }, { data: { provider_kind: "other-kind", provider_task_id: "t-1" }, error: null })
    await expect(claimHouseModelStart("job-1")).resolves.toEqual({ state: "taken" })
    db.answers.push({ data: [], error: null }, { data: null, error: null })
    await expect(claimHouseModelStart("job-1")).resolves.toEqual({ state: "taken" })
  })

  it("a database that cannot answer is an error, never a claim", async () => {
    db.answers.push({ data: null, error: { message: "connection reset" } })
    await expect(claimHouseModelStart("job-1")).resolves.toEqual({ state: "error", message: "connection reset" })
  })
})

describe("saveHouseModelReference", () => {
  it("replaces only the claim, with the planned cost in the same write", async () => {
    db.answers.push({ data: [{ id: "job-1" }], error: null })
    await expect(saveHouseModelReference("job-1", "ref-1", 0.25)).resolves.toBe(true)
    const [update, ...filters] = ops()
    expect(update![1]).toMatchObject({ provider_task_id: "ref-1", provider_cost: 0.25 })
    expect(filters).toContainEqual(["eq", "provider_kind", "house-model"])
    expect(filters).toContainEqual(["eq", "provider_task_id", HOUSE_MODEL_CLAIM_REF])
  })

  it("answers false when nothing was claimed to replace, or the write failed — never throws", async () => {
    db.answers.push({ data: [], error: null })
    await expect(saveHouseModelReference("job-1", "ref-1", 0.25)).resolves.toBe(false)
    db.answers.push({ data: null, error: { message: "timeout" } })
    await expect(saveHouseModelReference("job-1", "ref-1", 0.25)).resolves.toBe(false)
  })
})

describe("isHouseModelReference", () => {
  it("is a saved run's reference, never the claim or nothing", () => {
    expect(isHouseModelReference("ref-1")).toBe(true)
    expect(isHouseModelReference(HOUSE_MODEL_CLAIM_REF)).toBe(false)
    expect(isHouseModelReference("")).toBe(false)
    expect(isHouseModelReference(null)).toBe(false)
  })
})
