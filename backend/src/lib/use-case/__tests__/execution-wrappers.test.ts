/**
 * An outer run's cancel reaches its use-case wrappers through its node
 * states (the wrapper is never stamped with the run's execution id): the
 * owner's own live `use-case` jobs only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, fail: false }))
vi.mock("../../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = []
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
        maybeSingle: async () => {
          if (db.fail) throw new Error("down")
          return { data: (db.tables[table] ?? []).find((r) => filters.every((f) => f(r))) ?? null, error: null }
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: (db.tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }).then(resolve),
      }
      return q
    },
  },
}))

import { liveUseCaseWrappersOf } from "../execution-wrappers.js"
import { syncHttpIdempotencyKey } from "../../../services/workflow-engine/idempotency-key.js"

const OWN = syncHttpIdempotencyKey("exec-1", "t1")

beforeEach(() => {
  db.fail = false
  db.tables = {
    workflow_executions: [
      { id: "exec-1", user_id: "u1", node_states: { t1: { jobId: "w-live" }, t2: { jobId: "w-done" }, t3: { jobId: "w-held" }, t4: { jobId: "w-adopted" }, x: { jobIds: ["kie-1", "w-foreign"] } } },
    ],
    jobs: [
      { id: "w-live", user_id: "u1", provider: "use-case", status: "processing", workflow_execution_id: null, idempotency_key: OWN },
      // Adopted: another request's run the node followed (already_running / a newer generation).
      { id: "w-adopted", user_id: "u1", provider: "use-case", status: "processing", workflow_execution_id: null, idempotency_key: "client-key-from-the-editor" },
      { id: "w-done", user_id: "u1", provider: "use-case", status: "completed", workflow_execution_id: null },
      { id: "w-held", user_id: "u1", provider: "use-case", status: "pending_review", workflow_execution_id: null, idempotency_key: syncHttpIdempotencyKey("exec-1", "t3") },
      { id: "kie-1", user_id: "u1", provider: "kie", status: "processing" },
      { id: "w-foreign", user_id: "u2", provider: "use-case", status: "processing" },
    ],
  }
})

describe("liveUseCaseWrappersOf", () => {
  it("the owner's in-flight use-case wrappers this execution started (a held one too) — not adopted ones, finished ones, other providers, or another user's", async () => {
    expect((await liveUseCaseWrappersOf("exec-1", "u1")).sort()).toEqual(["w-held", "w-live"])
  })
  it("another user's execution names nothing", async () => {
    expect(await liveUseCaseWrappersOf("exec-1", "u2")).toEqual([])
  })
  it("a failed read is none (the orchestrator's own wait loop still cancels its wrapper)", async () => {
    db.fail = true
    expect(await liveUseCaseWrappersOf("exec-1", "u1")).toEqual([])
  })
})

describe("only the wrappers this execution started", () => {
  it("an adopted wrapper (another request's key, or another execution's) is left running", async () => {
    db.tables.jobs = [
      { id: "w-live", user_id: "u1", provider: "use-case", status: "processing", idempotency_key: OWN },
      { id: "w-held", user_id: "u1", provider: "use-case", status: "processing", idempotency_key: syncHttpIdempotencyKey("exec-2", "t1") },
      { id: "w-done", user_id: "u1", provider: "use-case", status: "processing", idempotency_key: null },
    ]
    expect(await liveUseCaseWrappersOf("exec-1", "u1")).toEqual(["w-live"])
  })
})

