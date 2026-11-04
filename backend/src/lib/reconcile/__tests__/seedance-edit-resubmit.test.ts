import { beforeEach, describe, expect, it, vi } from "vitest"

/** One job row in memory: every read and write goes through the filters it was given. */
const mocks = vi.hoisted(() => {
  const state: { job: Record<string, unknown>; afterRead?: () => void } = { job: {} }
  const matches = (filters: Array<(j: Record<string, unknown>) => boolean>) => filters.every((f) => f(state.job))
  const builder = (patch?: Record<string, unknown>) => {
    const filters: Array<(j: Record<string, unknown>) => boolean> = []
    const chain = {
      // SQL: `= NULL` matches nothing.
      eq: (col: string, val: unknown) => (filters.push((j) => j[col] !== null && j[col] !== undefined && j[col] === val), chain),
      is: (col: string, val: unknown) => (filters.push((j) => (j[col] ?? null) === val), chain),
      in: (col: string, vals: unknown[]) => (filters.push((j) => vals.includes(j[col])), chain),
      maybeSingle: async () => {
        const data = matches(filters) ? { ...state.job } : null
        state.afterRead?.()
        return { data, error: null }
      },
      select: async () => {
        if (!matches(filters)) return { data: [], error: null }
        Object.assign(state.job, patch)
        return { data: [{ id: state.job.id }], error: null }
      },
    }
    return chain
  }
  return {
    state,
    from: vi.fn(() => ({ select: () => builder(), update: (patch: Record<string, unknown>) => builder(patch) })),
    createKieTask: vi.fn(),
    readKieTaskRequest: vi.fn(),
  }
})

vi.mock("../../supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("../../job-failure.js", () => ({ FAILABLE_STATUSES: ["pending", "processing"] }))
vi.mock("../../../providers/kie/client.js", () => ({
  createKieTask: mocks.createKieTask,
  readKieTaskRequest: mocks.readKieTaskRequest,
}))

import { resubmitSeedanceEdit, SEEDANCE_EDIT_CLAIM_LIVE_MS, SEEDANCE_EDIT_RESEND_KEY } from "../seedance-edit-resubmit.js"

const REJECTED = Object.assign(new Error("Invalid input parameters. Please check your settings and try again."), {
  internalDetails:
    "task failed: [400] Parameter validation failed: ratio must be adaptive, duration must be -1, and the input video duration must be between 4 and 30 seconds",
})
const snapshot = {
  id: "j-1",
  provider_kind: "kie-standard",
  provider_task_id: "task-1",
  reconcile_attempts: 3,
  job_type: "image-to-video",
  input_data: { provider: "seedance-2-5" },
}
const SENT = {
  duration: 4,
  aspect_ratio: "9:16",
  resolution: "480p",
  prompt: "Redraw it",
  reference_video_urls: ["https://cdn.example/clip.mov"],
}
const job = () => mocks.state.job

describe("resubmitSeedanceEdit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.afterRead = undefined
    mocks.state.job = {
      id: "j-1",
      status: "processing",
      provider_task_id: "task-1",
      reconcile_attempts: 3,
      reconcile_last_error: null,
      input_data: { provider: "seedance-2-5", prompt: "Redraw it" },
    }
    mocks.readKieTaskRequest.mockResolvedValue({ model: "bytedance/seedance-2-5", input: SENT })
    mocks.createKieTask.mockResolvedValue({ taskId: "task-2" })
  })

  it("sends the task again as recorded with the two values asked for, and moves the job onto it", async () => {
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toEqual({ outcome: "resent", taskId: "task-2" })

    expect(mocks.readKieTaskRequest).toHaveBeenCalledWith("task-1")
    const [model, input, meta] = mocks.createKieTask.mock.calls[0]!
    expect(model).toBe("bytedance/seedance-2-5")
    expect(input).toEqual({ ...SENT, aspect_ratio: "adaptive", duration: -1 })
    expect(meta).toMatchObject({ modelKey: "seedance-2-5", dimensions: { resolution: "480p" } })

    expect(job()).toMatchObject({ provider_task_id: "task-2", reconcile_attempts: 0 })
    expect(job().provider_call_started_at).toEqual(expect.any(String))
    // The job's own input is kept, and its one resend is on record.
    expect(job().input_data).toEqual({
      provider: "seedance-2-5",
      prompt: "Redraw it",
      [SEEDANCE_EDIT_RESEND_KEY]: { task: "task-1", at: expect.any(Number) },
    })
  })

  it("two reconcilers at once: only one sends, and the other leaves the job alone", async () => {
    let second: unknown
    mocks.createKieTask.mockImplementationOnce(async () => {
      second = await resubmitSeedanceEdit(snapshot, REJECTED)
      return { taskId: "task-2" }
    })
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toMatchObject({ outcome: "resent" })
    expect(second).toEqual({ outcome: "taken" })
    expect(mocks.createKieTask).toHaveBeenCalledTimes(1)
  })

  it("a stale snapshot after the move is taken, never failed: the new task is rendering", async () => {
    await resubmitSeedanceEdit(snapshot, REJECTED)
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toEqual({ outcome: "taken" })
    expect(mocks.createKieTask).toHaveBeenCalledTimes(1)
  })

  const resent = (task: string, at: number) => ({ provider: "seedance-2-5", [SEEDANCE_EDIT_RESEND_KEY]: { task, at } })

  it("a reconciler that read before another's claim loses the compare-and-swap, and sends nothing", async () => {
    mocks.state.afterRead = () => {
      job().reconcile_last_error = "seedance_edit_resubmit"
    }
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toEqual({ outcome: "taken" })
    expect(mocks.createKieTask).not.toHaveBeenCalled()
  })

  it("a stale snapshot is taken even when the resend has aged: the row is on another task", async () => {
    job().provider_task_id = "task-2"
    job().input_data = resent("task-1", Date.now() - SEEDANCE_EDIT_CLAIM_LIVE_MS - 1)
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toEqual({ outcome: "taken" })
  })

  it("the record out of reach while another moved the job: taken, never failed", async () => {
    mocks.readKieTaskRequest.mockImplementationOnce(async () => {
      job().provider_task_id = "task-2"
      return null
    })
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toEqual({ outcome: "taken" })
  })

  it("the row cannot be read: taken, and the next tick decides", async () => {
    job().id = "another"
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toEqual({ outcome: "taken" })
    expect(mocks.createKieTask).not.toHaveBeenCalled()
  })

  it("a resend that aged out on the same task is a claimant that died: the failure stands and nothing is sent", async () => {
    job().input_data = resent("task-1", Date.now() - SEEDANCE_EDIT_CLAIM_LIVE_MS - 1)
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toEqual({ outcome: "stands" })
    expect(mocks.createKieTask).not.toHaveBeenCalled()
  })

  it.each([
    ["far in the future", Date.now() + 86_400_000],
    ["not a time", "soon"],
  ])("a resend whose time is %s ends the job rather than looping as taken", async (_name, at) => {
    job().input_data = { [SEEDANCE_EDIT_RESEND_KEY]: { task: "task-1", at } }
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toEqual({ outcome: "stands" })
  })

  it("the resent task rejected too: the failure stands", async () => {
    await resubmitSeedanceEdit(snapshot, REJECTED)
    await expect(resubmitSeedanceEdit({ ...snapshot, provider_task_id: "task-2" }, REJECTED)).resolves.toEqual({ outcome: "stands" })
    expect(mocks.createKieTask).toHaveBeenCalledTimes(1)
  })

  it("the resent task rejected after a bump overwrote the claim: never sent again, whatever the record echoes", async () => {
    await resubmitSeedanceEdit(snapshot, REJECTED)
    job().reconcile_last_error = "still running"
    await expect(resubmitSeedanceEdit({ ...snapshot, provider_task_id: "task-2" }, REJECTED)).resolves.toEqual({ outcome: "stands" })
    expect(mocks.createKieTask).toHaveBeenCalledTimes(1)
  })

  it("a task already in edit shape, with no resend on record, is not sent", async () => {
    mocks.readKieTaskRequest.mockResolvedValue({
      model: "bytedance/seedance-2-5",
      input: { ...SENT, aspect_ratio: "adaptive", duration: -1 },
    })
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toEqual({ outcome: "stands" })
    expect(mocks.createKieTask).not.toHaveBeenCalled()
  })

  it("claims over a bump's text on the row", async () => {
    job().reconcile_last_error = "still running"
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toMatchObject({ outcome: "resent" })
  })

  it("a live worker's retry moving the row during the send: not moved over it", async () => {
    mocks.createKieTask.mockImplementationOnce(async () => {
      job().provider_task_id = "task-from-the-worker"
      return { taskId: "task-2" }
    })
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toEqual({ outcome: "taken" })
    expect(job().provider_task_id).toBe("task-from-the-worker")
  })

  it("a job cancelled or finished is left alone, and nothing is sent", async () => {
    job().status = "cancelled"
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toEqual({ outcome: "taken" })
    expect(mocks.createKieTask).not.toHaveBeenCalled()
  })

  it("a job cancelled while sending is not moved", async () => {
    mocks.createKieTask.mockImplementationOnce(async () => {
      job().status = "cancelled"
      return { taskId: "task-2" }
    })
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toEqual({ outcome: "taken" })
    expect(job().provider_task_id).toBe("task-1")
  })

  it.each([
    ["another failure", snapshot, new Error("task failed: [500] internal error")],
    ["another model", { ...snapshot, input_data: { provider: "kling-4" } }, REJECTED],
    ["no provider on the job", { ...snapshot, input_data: null }, REJECTED],
    ["another provider kind", { ...snapshot, provider_kind: "kie-veo" }, REJECTED],
  ])("the failure stands on %s, reading nothing", async (_name, row, err) => {
    await expect(resubmitSeedanceEdit(row, err)).resolves.toEqual({ outcome: "stands" })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.createKieTask).not.toHaveBeenCalled()
  })

  it("the failure stands when the record is out of reach", async () => {
    mocks.readKieTaskRequest.mockResolvedValue(null)
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toEqual({ outcome: "stands" })
    expect(mocks.createKieTask).not.toHaveBeenCalled()
  })

  it("the failure stands when the new task is refused", async () => {
    mocks.createKieTask.mockRejectedValueOnce(new Error("refused"))
    await expect(resubmitSeedanceEdit(snapshot, REJECTED)).resolves.toEqual({ outcome: "stands" })
    expect(job().provider_task_id).toBe("task-1")
  })
})
