/**
 * Crash recovery reads only the execution owner's jobs (decided 2026-10-06;
 * migration 474).
 *
 * `reconcileNodeStatesFromJobs` turns `jobs` rows into a node's status and
 * output, which the execution's owner then sees. It finds them two ways — a
 * job id in node_states, and job rows naming the execution — and both are
 * pointers: node_states is the owner's to write, and before 474 any browser
 * could insert a `jobs` row naming any execution. So both lookups ask for the
 * owner's rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({ jobs: [] as Row[] }))

vi.mock("../../supabase.js", () => {
  // Applies every `.eq` / `.in` filter, so a lookup that leaves the owner out
  // returns the planted row and the test sees it.
  function builder() {
    const filters: Array<(r: Row) => boolean> = []
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, v: unknown) => { filters.push((r) => r[col] === v); return chain },
      in: (col: string, v: unknown[]) => { filters.push((r) => v.includes(r[col])); return chain },
      then: (resolve: (v: { data: Row[] }) => unknown) =>
        Promise.resolve({
          data: db.jobs
            .filter((r) => filters.every((f) => f(r)))
            .map((r) => ({ ...r, node_id: (r.input_data as Row | undefined)?.node_id })),
        }).then(resolve),
    }
    return chain
  }
  return { supabase: { from: () => builder() } }
})

import { reconcileNodeStatesFromJobs } from "../node-states.js"

beforeEach(() => { db.jobs = [] })

describe("reconcileNodeStatesFromJobs — another user's job is never this run's", () => {
  it("attacker: a planted completed job naming the execution does not complete the node", async () => {
    db.jobs = [{
      id: "planted", user_id: "attacker", workflow_execution_id: "exec-1", status: "completed",
      error_message: null, output_data: { imageUrl: "https://evil.example/x.png" }, input_data: { node_id: "n1" },
    }]
    const { next, changed } = await reconcileNodeStatesFromJobs({ n1: { status: "running" } }, "exec-1", "owner-1")
    expect(changed).toBe(false)
    expect(next.n1.status).toBe("running")
    expect(next.n1.jobId).toBeUndefined()
  })

  it("attacker: a job id in node_states that is someone else's job is not read into the node", async () => {
    // The owner writes their own node_states; pointing a node at another
    // user's finished job must not copy that job's status or output here.
    db.jobs = [{
      id: "victim-job", user_id: "victim", workflow_execution_id: "victim-exec", status: "failed",
      error_message: "victim's error", output_data: { scenePlan: { secret: true } }, input_data: { node_id: "x" },
    }]
    const { next, changed } = await reconcileNodeStatesFromJobs(
      { n1: { status: "running", jobId: "victim-job" } }, "exec-1", "owner-1",
    )
    expect(changed).toBe(false)
    expect(next.n1.status).toBe("running")
    expect(next.n1.error).toBeUndefined()
  })

  it("the owner's own jobs still recover the node, by either path", async () => {
    db.jobs = [
      { id: "j1", user_id: "owner-1", workflow_execution_id: "exec-1", status: "completed", error_message: null, output_data: {}, input_data: { node_id: "n1" } },
      { id: "j2", user_id: "owner-1", workflow_execution_id: "exec-1", status: "completed", error_message: null, output_data: {}, input_data: { node_id: "n2" } },
    ]
    const { next } = await reconcileNodeStatesFromJobs(
      { n1: { status: "running", jobId: "j1" }, n2: { status: "pending" } }, "exec-1", "owner-1",
    )
    expect(next.n1.status).toBe("completed")
    expect(next.n2.status).toBe("completed")
    expect(next.n2.jobId).toBe("j2")
  })
})
