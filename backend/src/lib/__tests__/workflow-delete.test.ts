import { beforeEach, describe, expect, it, vi } from "vitest"

const { rpc, from, deleteFromR2, r2KeyFromOurUrl, isRelayedJob, relayOwnedKeys } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  deleteFromR2: vi.fn(),
  r2KeyFromOurUrl: vi.fn(),
  isRelayedJob: vi.fn(),
  relayOwnedKeys: vi.fn(),
}))

vi.mock("../supabase.js", () => ({
  supabase: { rpc, from },
}))

// The relay rule's shared predicate lives with the canonical delete core.
vi.mock("../asset-delete.js", () => ({ isRelayedJob, relayOwnedKeys }))

/**
 * THE ARMING GATE (lib/relay-possible.ts). Both reads this module makes for the
 * relay rule sit behind it — the pre-RPC job-row read most of all, which
 * without a gate is a `jobs` round trip on EVERY job delete on EVERY
 * deployment, paid ahead of the durable delete. Default OFF; the relay describe
 * arms it, and one case below pins that the gate really does suppress the read.
 */
const relayGate = vi.hoisted(() => ({ on: false }))
vi.mock("../relay-possible.js", () => ({ relayPossible: () => relayGate.on }))

vi.mock("../storage.js", () => ({
  deleteFromR2,
  r2KeyFromOurUrl,
}))

import {
  deleteJobWithPrivateMedia,
  deleteProjectWithPrivateMedia,
  deleteWorkflowWithPrivateMedia,
} from "../workflow-delete.js"

const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const USER_ID = "00000000-0000-4000-8000-000000000001"

describe("deleteWorkflowWithPrivateMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    relayGate.on = false
    deleteFromR2.mockResolvedValue(undefined)
    isRelayedJob.mockResolvedValue(false)
    relayOwnedKeys.mockResolvedValue(new Set())
    r2KeyFromOurUrl.mockImplementation((url: string) =>
      url.startsWith("https://cdn.test/") ? url.slice("https://cdn.test/".length) : null,
    )
  })

  it("uses the atomic RPC and deletes each captured owned private base", async () => {
    rpc.mockResolvedValue({
      data: {
        deleted: true,
        baseUrls: [
          "https://cdn.test/videos/gvp-1-stitched.mp4",
          "https://cdn.test/videos/gvp-1-stitched.mp4",
          "https://cdn.test/videos/gvp-2-silent-base.mp4",
        ],
      },
      error: null,
    })

    await expect(deleteWorkflowWithPrivateMedia({
      workflowId: WORKFLOW_ID,
      userId: USER_ID,
    })).resolves.toBe(true)

    expect(rpc).toHaveBeenCalledWith("delete_workflow_with_recast_cleanup", {
      p_workflow_id: WORKFLOW_ID,
      p_user_id: USER_ID,
    })
    expect(deleteFromR2).toHaveBeenCalledTimes(2)
    expect(deleteFromR2).toHaveBeenCalledWith("videos/gvp-1-stitched.mp4")
    expect(deleteFromR2).toHaveBeenCalledWith("videos/gvp-2-silent-base.mp4")
  })

  it("returns false without touching storage when the scoped workflow did not exist", async () => {
    rpc.mockResolvedValue({
      data: { deleted: false, baseUrls: [] },
      error: null,
    })

    await expect(deleteWorkflowWithPrivateMedia({
      workflowId: WORKFLOW_ID,
      userId: USER_ID,
    })).resolves.toBe(false)

    expect(r2KeyFromOurUrl).not.toHaveBeenCalled()
    expect(deleteFromR2).not.toHaveBeenCalled()
  })

  it("throws before storage cleanup when the atomic database delete fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "database down" } })

    await expect(deleteWorkflowWithPrivateMedia({
      workflowId: WORKFLOW_ID,
      userId: USER_ID,
    })).rejects.toThrow("Failed to delete workflow: database down")
    expect(deleteFromR2).not.toHaveBeenCalled()
  })

  it("fails closed on a malformed RPC response", async () => {
    rpc.mockResolvedValue({ data: { deleted: true, baseUrls: "private" }, error: null })

    await expect(deleteWorkflowWithPrivateMedia({
      workflowId: WORKFLOW_ID,
      userId: USER_ID,
    })).rejects.toThrow("Malformed workflow delete response")
    expect(r2KeyFromOurUrl).not.toHaveBeenCalled()
  })

  it("skips foreign URLs and reports R2 failures without exposing private URLs", async () => {
    rpc.mockResolvedValue({
      data: {
        deleted: true,
        baseUrls: [
          "https://foreign.test/private.mp4?token=secret",
          "https://cdn.test/videos/gvp-1-stitched.mp4?token=secret",
        ],
      },
      error: null,
    })
    deleteFromR2.mockRejectedValue(new Error("r2 down"))
    const warn = vi.fn()

    await expect(deleteWorkflowWithPrivateMedia({
      workflowId: WORKFLOW_ID,
      userId: USER_ID,
      logger: { warn },
    })).resolves.toBe(true)

    expect(deleteFromR2).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalled()
    expect(JSON.stringify(warn.mock.calls)).not.toContain("token=secret")
    expect(JSON.stringify(warn.mock.calls)).not.toContain("foreign.test")
  })

  it("uses the project RPC to capture bases across cascading workflows", async () => {
    rpc.mockResolvedValue({
      data: {
        deleted: true,
        baseUrls: ["https://cdn.test/videos/gvp-project-base.mp4"],
      },
      error: null,
    })

    await expect(deleteProjectWithPrivateMedia({
      projectId: WORKFLOW_ID,
      userId: USER_ID,
    })).resolves.toBe(true)

    expect(rpc).toHaveBeenCalledWith("delete_project_with_recast_cleanup", {
      p_project_id: WORKFLOW_ID,
      p_user_id: USER_ID,
    })
    expect(deleteFromR2).toHaveBeenCalledWith("videos/gvp-project-base.mp4")
  })

  it("uses the job RPC with explicit actor/admin scope", async () => {
    rpc.mockResolvedValue({
      data: {
        deleted: true,
        baseUrls: ["https://cdn.test/videos/gvp-job-base.mp4"],
      },
      error: null,
    })

    await expect(deleteJobWithPrivateMedia({
      jobId: WORKFLOW_ID,
      actorUserId: USER_ID,
      isAdmin: true,
    })).resolves.toBe(true)

    expect(rpc).toHaveBeenCalledWith("delete_job_with_recast_cleanup", {
      p_job_id: WORKFLOW_ID,
      p_actor_user_id: USER_ID,
      p_is_admin: true,
    })
    expect(deleteFromR2).toHaveBeenCalledWith("videos/gvp-job-base.mp4")
  })
})

// ---------------------------------------------------------------------------
// The relay delete rule (spec 2026-09-04-sai-local-development §9.3, D18)
// ---------------------------------------------------------------------------

describe("deleteJobWithPrivateMedia — relay-owned bases", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    relayGate.on = true
    deleteFromR2.mockResolvedValue(undefined)
    isRelayedJob.mockResolvedValue(false)
    relayOwnedKeys.mockResolvedValue(new Set())
    r2KeyFromOurUrl.mockImplementation((url: string) =>
      url.startsWith("https://cdn.test/") ? url.slice("https://cdn.test/".length) : null,
    )
  })

  it("keeps a base created by our relay target and still reports the delete", async () => {
    rpc.mockResolvedValue({
      data: { deleted: true, baseUrls: ["https://cdn.test/videos/far-end-base.mp4"] },
      error: null,
    })
    isRelayedJob.mockResolvedValue(true)

    await expect(deleteJobWithPrivateMedia({
      jobId: WORKFLOW_ID,
      actorUserId: USER_ID,
      isAdmin: false,
    })).resolves.toBe(true)

    // Read BEFORE the RPC: the RPC cascades the jobs row away, so the same
    // question asked afterwards would answer "not relayed" for every job.
    expect(isRelayedJob).toHaveBeenCalledWith(WORKFLOW_ID)
    expect(isRelayedJob.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0])
    expect(deleteFromR2).not.toHaveBeenCalled()
  })

  it("is byte-identical to today when the job carries no relay provenance", async () => {
    rpc.mockResolvedValue({
      data: { deleted: true, baseUrls: ["https://cdn.test/videos/gvp-job-base.mp4"] },
      error: null,
    })

    await expect(deleteJobWithPrivateMedia({
      jobId: WORKFLOW_ID,
      actorUserId: USER_ID,
      isAdmin: false,
    })).resolves.toBe(true)

    expect(deleteFromR2).toHaveBeenCalledWith("videos/gvp-job-base.mp4")
  })

  it("asks NOTHING at all with no relay target configured", async () => {
    relayGate.on = false
    rpc.mockResolvedValue({
      data: { deleted: true, baseUrls: ["https://cdn.test/videos/gvp-job-base.mp4"] },
      error: null,
    })
    isRelayedJob.mockResolvedValue(true)
    relayOwnedKeys.mockResolvedValue(new Set(["videos/gvp-job-base.mp4"]))

    await expect(deleteJobWithPrivateMedia({
      jobId: WORKFLOW_ID,
      actorUserId: USER_ID,
      isAdmin: false,
    })).resolves.toBe(true)

    // Neither predicate is consulted — and the object is deleted, exactly as
    // origin/dev deleted it.
    expect(isRelayedJob).not.toHaveBeenCalled()
    expect(relayOwnedKeys).not.toHaveBeenCalled()
    expect(deleteFromR2).toHaveBeenCalledWith("videos/gvp-job-base.mp4")
  })

  it("asks the JOB-ROW question only on the job scope", async () => {
    rpc.mockResolvedValue({
      data: { deleted: true, baseUrls: ["https://cdn.test/videos/gvp-1-stitched.mp4"] },
      error: null,
    })

    await deleteWorkflowWithPrivateMedia({ workflowId: WORKFLOW_ID, userId: USER_ID })
    await deleteProjectWithPrivateMedia({ projectId: WORKFLOW_ID, userId: USER_ID })

    expect(isRelayedJob).not.toHaveBeenCalled()
    expect(deleteFromR2).toHaveBeenCalledTimes(2)
  })

  /**
   * The scope limitation the job-row read could not close: a base url belongs
   * to a GVP job somewhere inside the deleted subtree, and PostgREST cannot
   * express "the relayed jobs under this workflow". The DURABLE per-object
   * marker can — it is keyed on the OBJECT, not on a job the RPC already
   * cascaded away, so one question covers all three scopes.
   */
  it("keeps a relay-owned base on the workflow scope, where no job id is in hand", async () => {
    rpc.mockResolvedValue({
      data: {
        deleted: true,
        baseUrls: [
          "https://cdn.test/videos/far-end-base.mp4",
          "https://cdn.test/videos/ours.mp4",
        ],
      },
      error: null,
    })
    relayOwnedKeys.mockResolvedValue(new Set(["videos/far-end-base.mp4"]))

    await expect(
      deleteWorkflowWithPrivateMedia({ workflowId: WORKFLOW_ID, userId: USER_ID }),
    ).resolves.toBe(true)

    expect(deleteFromR2).toHaveBeenCalledExactlyOnceWith("videos/ours.mp4")
  })

  it("keeps a relay-owned base on the project scope too", async () => {
    rpc.mockResolvedValue({
      data: { deleted: true, baseUrls: ["https://cdn.test/videos/far-end-base.mp4"] },
      error: null,
    })
    relayOwnedKeys.mockResolvedValue(new Set(["videos/far-end-base.mp4"]))

    await expect(
      deleteProjectWithPrivateMedia({ projectId: WORKFLOW_ID, userId: USER_ID }),
    ).resolves.toBe(true)

    expect(deleteFromR2).not.toHaveBeenCalled()
  })
})
