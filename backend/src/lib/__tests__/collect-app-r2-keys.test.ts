/**
 * collectAppR2Keys harvests an app's media for the admin expunge. A run's
 * execution ids (`execution_id`, and its Render final's `final_execution_id`)
 * are server-written since migration 469, but rows planted before it, and a
 * chain's runner-writable stamps, remain; so the harvest reads an execution —
 * and its jobs — only when it is that run's runner's own: a run pointing at
 * another user's execution must not get that user's media deleted when the
 * app is expunged (decided 2026-10-06).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, unknown>
const tables = vi.hoisted(() => ({ current: {} as Record<string, Row[]> }))

vi.mock("../supabase.js", () => {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = []
    let single = false
    let limit = Infinity
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), builder),
      in: (col: string, vals: unknown[]) => (filters.push((r) => vals.includes(r[col])), builder),
      gt: (col: string, val: string) => (filters.push((r) => String(r[col]) > val), builder),
      order: () => builder,
      limit: (n: number) => ((limit = n), builder),
      single: () => ((single = true), builder),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        const rows = (tables.current[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, limit)
        return Promise.resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }).then(resolve, reject)
      },
    }
    return builder
  }
  return { supabase: { from } }
})

vi.mock("../../ee/billing/cleanup-service.js", () => ({
  r2KeyFromUrl: (url: string) => (url.startsWith("https://r2.test/") ? url.slice("https://r2.test/".length) : null),
}))

import { collectAppR2Keys } from "../collect-app-r2-keys.js"
import { resetFinalExecutionColumnForTests } from "../app-run-final-column.js"

const url = (key: string) => `https://r2.test/${key}`

beforeEach(() => {
  resetFinalExecutionColumnForTests()
  tables.current = {
    published_apps: [{ id: "app", icon_url: url("icon"), preview_media_url: null, snapshot_nodes: [] }],
    app_runs: [
      { id: "r1", app_id: "app", runner_id: "alice", input_values: null, node_states: null, execution_id: "e-alice", final_execution_id: "f-alice" },
      // Mallory points her run (and its final) at Bob's executions.
      { id: "r2", app_id: "app", runner_id: "mallory", input_values: null, node_states: null, execution_id: "e-bob", final_execution_id: "f-bob" },
      { id: "r3", app_id: "app", runner_id: "mallory", input_values: null, node_states: null, execution_id: null, final_execution_id: "f-mallory" },
    ],
    workflow_executions: [
      { id: "e-alice", user_id: "alice", node_states: { a: { output: { url: url("alice-run") } } } },
      {
        id: "f-alice",
        user_id: "alice",
        node_states: { a: { output: { url: url("alice-final") } } },
        trigger_data: { appRenderFinal: { appRunId: "r1", appVersionId: "app", continuedFrom: "f0-alice" } },
      },
      // Alice's first final of a chain (decided 2026-10-06): the run links only the newest.
      {
        id: "f0-alice",
        user_id: "alice",
        node_states: { a: { output: { url: url("alice-first-final") } } },
        trigger_data: { appRenderFinal: { appRunId: "r1", appVersionId: "app", continuedFrom: "e-alice" } },
      },
      { id: "e-bob", user_id: "bob", node_states: { b: { output: { url: url("bob-run") } } } },
      { id: "f-bob", user_id: "bob", node_states: { b: { output: { url: url("bob-final") } } } },
      // Mallory's own final, its stamp forged to name Bob's execution as an earlier final.
      {
        id: "f-mallory",
        user_id: "mallory",
        node_states: {},
        trigger_data: { appRenderFinal: { appRunId: "r3", appVersionId: "app", continuedFrom: "e-bob" } },
      },
    ],
    jobs: [
      { workflow_execution_id: "f-alice", output_data: { url: url("alice-final-job") } },
      { workflow_execution_id: "f0-alice", output_data: { url: url("alice-first-final-job") } },
      { workflow_execution_id: "e-bob", output_data: { url: url("bob-run-job") } },
      { workflow_execution_id: "f-bob", output_data: { url: url("bob-final-job") } },
    ],
  }
})

describe("collectAppR2Keys", () => {
  it("harvests a run's own execution and its final, with their jobs", async () => {
    const keys = await collectAppR2Keys("app")
    expect(keys).toEqual(expect.arrayContaining(["icon", "alice-run", "alice-final", "alice-final-job"]))
  })

  it("harvests the earlier finals of a chain too, by their stamps", async () => {
    const keys = await collectAppR2Keys("app")
    expect(keys).toEqual(expect.arrayContaining(["alice-first-final", "alice-first-final-job"]))
  })

  it("never harvests an execution (or its jobs) that is not the run's runner's own", async () => {
    const keys = await collectAppR2Keys("app")
    expect(keys.filter((k) => k.startsWith("bob"))).toEqual([])
  })
})
