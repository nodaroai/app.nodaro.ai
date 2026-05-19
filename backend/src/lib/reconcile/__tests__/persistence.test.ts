import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the supabase singleton BEFORE importing the module under test.
const updateMock = vi.fn().mockReturnThis()
const eqMock = vi.fn().mockResolvedValue({ data: null, error: null })

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      update: updateMock,
      eq: eqMock,
    })),
  },
}))

import { supabase } from "../../supabase.js"
import { makeOnTaskCreated, markProviderCallStart } from "../persistence.js"

describe("makeOnTaskCreated", () => {
  beforeEach(() => {
    updateMock.mockClear()
    eqMock.mockClear()
    ;(supabase.from as ReturnType<typeof vi.fn>).mockClear()
  })

  it("returns a callback that writes provider_kind, provider_task_id, and provider_call_started_at to jobs", async () => {
    const cb = makeOnTaskCreated("job-123", "kie-standard")
    await cb("kie-task-abc")
    expect(supabase.from).toHaveBeenCalledWith("jobs")
    expect(updateMock).toHaveBeenCalledTimes(1)
    const updateArg = updateMock.mock.calls[0]![0]
    expect(updateArg.provider_kind).toBe("kie-standard")
    expect(updateArg.provider_task_id).toBe("kie-task-abc")
    expect(typeof updateArg.provider_call_started_at).toBe("string")
    expect(new Date(updateArg.provider_call_started_at).getTime()).toBeGreaterThan(Date.now() - 5000)
    expect(eqMock).toHaveBeenCalledWith("id", "job-123")
  })

  it("does not throw if the DB write fails (best-effort)", async () => {
    eqMock.mockResolvedValueOnce({ data: null, error: { message: "transient" } })
    const cb = makeOnTaskCreated("job-456", "kie-veo")
    await expect(cb("task-x")).resolves.toBeUndefined()
  })

  it("does not throw if the underlying call throws", async () => {
    eqMock.mockRejectedValueOnce(new Error("network down"))
    const cb = makeOnTaskCreated("job-789", "kie-suno")
    await expect(cb("task-y")).resolves.toBeUndefined()
  })
})

describe("markProviderCallStart", () => {
  beforeEach(() => {
    updateMock.mockClear()
    eqMock.mockClear()
  })

  it("writes provider_kind + provider_call_started_at (no provider_task_id)", async () => {
    await markProviderCallStart("job-789", "anthropic-sync")
    const updateArg = updateMock.mock.calls[0]![0]
    expect(updateArg.provider_kind).toBe("anthropic-sync")
    expect(updateArg.provider_task_id).toBeUndefined()
    expect(typeof updateArg.provider_call_started_at).toBe("string")
    expect(eqMock).toHaveBeenCalledWith("id", "job-789")
  })

  it("does not throw if the DB write fails", async () => {
    eqMock.mockResolvedValueOnce({ data: null, error: { message: "transient" } })
    await expect(markProviderCallStart("job-x", "elevenlabs-sync")).resolves.toBeUndefined()
  })
})
