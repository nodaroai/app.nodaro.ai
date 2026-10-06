/**
 * Crash recovery must deliver the SAME refusal the live orchestrator does.
 *
 * `reconcileNodeStatesFromJobs` rebuilds a node's state from the `jobs` table
 * after the orchestrator died mid-run. It read `id, status, error_message` and
 * wrote `status`/`error`/`jobId` — so a 3D-scene run refused while the worker
 * was ALIVE delivered its billed draft, and the exact same run refused while
 * the worker was DOWN delivered a bare error. Same job, same money, two
 * different answers, decided by an implementation detail of ours.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type JobRow = Record<string, unknown>
let path1Rows: JobRow[] = []
let path2Rows: JobRow[] = []
const selects: string[] = []

vi.mock("../../supabase.js", () => {
  function builder() {
    let isPath2 = false
    const chain: Record<string, unknown> = {
      select(cols: string) {
        selects.push(cols)
        return chain
      },
      eq(col: string) {
        if (col === "workflow_execution_id") isPath2 = true
        return chain
      },
      in() {
        return chain
      },
      then(resolve: (v: { data: JobRow[] }) => unknown) {
        return Promise.resolve({ data: isPath2 ? path2Rows : path1Rows }).then(resolve)
      },
    }
    return chain
  }
  return { supabase: { from: () => builder() } }
})

import { reconcileNodeStatesFromJobs } from "../node-states.js"

const DRAFT = { planType: "3d-scene", revisionId: "rev-9", objects: [] }

beforeEach(() => {
  path1Rows = []
  path2Rows = []
  selects.length = 0
})

describe("reconcileNodeStatesFromJobs — a refused run's retained draft", () => {
  it("carries output onto the recovered FAILED node (jobId path)", async () => {
    path1Rows = [
      {
        id: "job-1",
        status: "failed",
        error_message: "SCENE_QUALITY_FAILED: the reviewer refused the scene",
        output_data: { scenePlan: DRAFT, sceneRevisionId: "rev-9", validation: { status: "failed" } },
      },
    ]
    const { next, changed } = await reconcileNodeStatesFromJobs({
      s1: { status: "running", nodeType: "generate-3d-scene", jobId: "job-1" },
    }, "exec-1", "owner-1")
    expect(changed).toBe(true)
    expect(next.s1.status).toBe("failed")
    expect(next.s1.error).toContain("SCENE_QUALITY_FAILED")
    expect(next.s1.output).toEqual({ plan: DRAFT })
  })

  it("carries it on the execution-scoped path too (the crash before jobId was persisted)", async () => {
    path2Rows = [
      {
        id: "job-2",
        status: "failed",
        error_message: "refused",
        output_data: { scenePlan: DRAFT },
        node_id: "s2",
      },
    ]
    const { next } = await reconcileNodeStatesFromJobs(
      { s2: { status: "pending", nodeType: "edit-3d-scene" } },
      "exec-1",
      "owner-1",
    )
    expect(next.s2.status).toBe("failed")
    expect(next.s2.output).toEqual({ plan: DRAFT })
    expect(next.s2.jobId).toBe("job-2")
  })

  it("reads output_data on BOTH lookup paths", async () => {
    path1Rows = []
    path2Rows = []
    await reconcileNodeStatesFromJobs({ s1: { status: "running", jobId: "job-1" } }, "exec-1", "owner-1")
    expect(selects).toHaveLength(2)
    for (const cols of selects) expect(cols).toContain("output_data")
  })

  it("leaves a plain failure's output undefined", async () => {
    path1Rows = [{ id: "job-3", status: "failed", error_message: "Provider timeout", output_data: null }]
    const { next } = await reconcileNodeStatesFromJobs({
      s3: { status: "running", nodeType: "generate-video", jobId: "job-3" },
    }, "exec-1", "owner-1")
    expect(next.s3.status).toBe("failed")
    expect(next.s3.output).toBeUndefined()
  })

  it("never overwrites an output the node already carried", async () => {
    path1Rows = [{ id: "job-4", status: "failed", error_message: "refused", output_data: { scenePlan: DRAFT } }]
    const kept = { plan: { planType: "3d-scene", revisionId: "rev-earlier" } }
    const { next } = await reconcileNodeStatesFromJobs({
      s4: { status: "running", nodeType: "generate-3d-scene", jobId: "job-4", output: kept },
    }, "exec-1", "owner-1")
    expect(next.s4.output).toEqual(kept)
  })
})
