import { beforeEach, describe, expect, it, vi } from "vitest"

const { rpc, deleteFromR2, r2KeyFromOurUrl } = vi.hoisted(() => ({
  rpc: vi.fn(),
  deleteFromR2: vi.fn(),
  r2KeyFromOurUrl: vi.fn(),
}))

vi.mock("../supabase.js", () => ({
  supabase: { rpc },
}))

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
    deleteFromR2.mockResolvedValue(undefined)
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
