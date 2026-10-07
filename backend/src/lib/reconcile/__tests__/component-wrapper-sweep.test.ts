/**
 * `sweepStuckComponentWrappers` fails a component wrapper stranded past every
 * timeout, and writes its nested run's status into the wrapper's error
 * message — which the wrapper's owner reads. The nested run is named by the
 * wrapper's `_executionId`, a pointer, so the sweep reads it only as the
 * wrapper owner's run (decided 2026-10-06; migration 474). Anyone else's run
 * reads as missing: its status never reaches the message.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({
  wrappers: [] as Row[],
  executions: [] as Row[],
  failed: [] as Array<{ id: string; error_message: string }>,
}))

vi.mock("../../supabase.js", () => {
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, v: unknown) => { filters.push((r) => col in r ? r[col] === v : true); return chain },
      lt: () => chain,
      limit: async () => ({ data: table === "jobs" ? db.wrappers : [], error: null }),
      maybeSingle: async () => ({
        data: (table === "workflow_executions" ? db.executions : []).find((r) => filters.every((f) => f(r))) ?? null,
        error: null,
      }),
    }
    return chain
  }
  return { supabase: { from: (t: string) => builder(t) } }
})
vi.mock("../../job-failure.js", () => ({
  markJobFailed: vi.fn(async (id: string, opts: { error_message: string }) => {
    db.failed.push({ id, error_message: opts.error_message })
  }),
}))

import { sweepStuckComponentWrappers, type ReconcileResult } from "../cron.js"

const result = (): ReconcileResult => ({ scanned: 0, swept: 0, recovered: 0, notStale: 0, errors: 0 })

beforeEach(() => {
  db.wrappers = []
  db.executions = []
  db.failed = []
})

describe("sweepStuckComponentWrappers — the nested run must be the wrapper owner's", () => {
  it("the owner's own finished nested run: failed with its status, as before", async () => {
    db.wrappers = [{ id: "w1", user_id: "owner-1", input_data: { _executionId: "inner-1" } }]
    db.executions = [{ id: "inner-1", user_id: "owner-1", status: "failed" }]
    await sweepStuckComponentWrappers(result())
    expect(db.failed).toEqual([{ id: "w1", error_message: "Component inner execution failed" }])
  })

  it("the owner's nested run still going: left alone", async () => {
    db.wrappers = [{ id: "w1", user_id: "owner-1", input_data: { _executionId: "inner-1" } }]
    db.executions = [{ id: "inner-1", user_id: "owner-1", status: "running" }]
    await sweepStuckComponentWrappers(result())
    expect(db.failed).toEqual([])
  })

  it("attacker: a wrapper naming another user's run reads it as missing — that run's status never leaks", async () => {
    db.wrappers = [{ id: "w-planted", user_id: "attacker", input_data: { _executionId: "victim-run" } }]
    db.executions = [{ id: "victim-run", user_id: "victim", status: "completed" }]
    await sweepStuckComponentWrappers(result())
    expect(db.failed).toEqual([{ id: "w-planted", error_message: "Component inner execution missing" }])
  })
})
