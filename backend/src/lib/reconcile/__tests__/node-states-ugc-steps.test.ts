/**
 * A node that runs several jobs of its own as the steps of ONE node — UGC
 * Creator's images and readings, UGC Cards' two timing jobs — is never settled
 * by one of them. Every child is registered with the run (`onJobCreated` puts
 * it on the node's `jobIds`), so after a crash the recovery would otherwise mark
 * a creator mid-round `completed` (with no output) the moment one candidate's
 * image had finished, or `failed` on a moderation block the round drops
 * silently. Left running, the node runs again on the re-pick, and each child is
 * handed back by its own idempotency key.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type JobRow = Record<string, unknown>
let path1Rows: JobRow[] = []
let path2Rows: JobRow[] = []

vi.mock("../../supabase.js", () => {
  function builder() {
    let isPath2 = false
    const chain: Record<string, unknown> = {
      select() {
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

beforeEach(() => {
  path1Rows = []
  path2Rows = []
})

describe("reconcileNodeStatesFromJobs — a node whose jobs are its steps", () => {
  it("a running UGC Creator stays running whatever its children did; a node beside it still settles", async () => {
    path1Rows = [
      { id: "img-a", status: "completed", output_data: { imageUrl: "https://cdn.example/a.png" } },
      { id: "img-b", status: "failed", error_message: "blocked", output_data: null },
      { id: "job-v", status: "completed", output_data: { videoUrl: "https://cdn.example/v.mp4" } },
    ]
    const { next } = await reconcileNodeStatesFromJobs({
      creator: { status: "running", nodeType: "ugc-creator", jobId: "img-b", jobIds: ["img-a", "img-b"] },
      video: { status: "running", nodeType: "generate-video", jobId: "job-v" },
    }, "exec-1", "owner-1")
    expect(next.creator).toMatchObject({ status: "running" })
    expect(next.creator!.output).toBeUndefined()
    expect(next.video!.status).toBe("completed")
  })

  it("a running UGC Cards stays running when one timing job finished", async () => {
    path1Rows = [{ id: "al-1", status: "completed", output_data: { alignment: [] } }]
    const { next, changed } = await reconcileNodeStatesFromJobs({
      cards: { status: "running", nodeType: "ugc-cards", jobId: "al-1", jobIds: ["al-1"] },
    }, "exec-1", "owner-1")
    expect(next.cards!.status).toBe("running")
    expect(changed).toBe(false)
  })

  it("a job row naming the node on the execution-scoped path settles it no more than its jobIds do", async () => {
    path2Rows = [{ id: "img-a", status: "completed", output_data: { imageUrl: "https://cdn.example/a.png" }, node_id: "creator" }]
    const { next } = await reconcileNodeStatesFromJobs({
      creator: { status: "pending", nodeType: "ugc-creator" },
    }, "exec-1", "owner-1")
    expect(next.creator!.status).toBe("pending")
  })

  it("a UGC node whose route owns ONE job (UGC Script, UGC Clip) still settles off it", async () => {
    path1Rows = [{ id: "job-s", status: "completed", output_data: { plan: { hook: "h" } } }]
    const { next } = await reconcileNodeStatesFromJobs({
      script: { status: "running", nodeType: "ugc-script", jobId: "job-s" },
    }, "exec-1", "owner-1")
    expect(next.script!.status).toBe("completed")
  })
})
