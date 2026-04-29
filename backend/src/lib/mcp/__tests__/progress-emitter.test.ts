import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { registerTask, _resetRegistry } from "../tasks.js"
import {
  startProgressEmitter,
  stopProgressEmitter,
} from "../progress-emitter.js"

// Hoisted mock state — vi.mock factories capture lexically and the module
// path is the same one tasks.ts and progress-emitter.ts use ("../supabase.js"
// relative to those files = "../../supabase.js" relative to this test).
const mockJobsRow = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; status: string; progress: number | null }>,
}))

vi.mock("../../supabase.js", () => {
  const inFn = vi.fn(async () => ({
    data: mockJobsRow.rows,
    error: null,
  }))
  const select = vi.fn(() => ({ in: inFn }))
  const eq = vi.fn().mockResolvedValue({ data: null, error: null })
  const update = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select, update }))
  return {
    supabase: { from },
  }
})

function makeServer(): { server: unknown; calls: unknown[] } {
  const calls: unknown[] = []
  const server = {
    server: {
      notification: vi.fn(async (n: unknown) => {
        calls.push(n)
      }),
    },
  }
  return { server, calls }
}

describe("progress emitter", () => {
  beforeEach(() => {
    _resetRegistry()
    mockJobsRow.rows = []
    vi.useFakeTimers()
  })

  afterEach(() => {
    stopProgressEmitter()
    vi.useRealTimers()
  })

  it("emits a notifications/progress event when a tracked job's progress advances", async () => {
    registerTask({ taskId: "j-1", userId: "u-1", kind: "image" })
    mockJobsRow.rows = [{ id: "j-1", status: "processing", progress: 50 }]

    const { server, calls } = makeServer()
    startProgressEmitter(server as never)

    await vi.advanceTimersByTimeAsync(1100)

    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls[0]).toMatchObject({
      method: "notifications/progress",
      params: {
        progressToken: "j-1",
        progress: 50,
        total: 100,
      },
    })
  })

  it("emits a single notification per progress value (no spam at unchanged %)", async () => {
    registerTask({ taskId: "j-2", userId: "u-1", kind: "video" })
    mockJobsRow.rows = [{ id: "j-2", status: "processing", progress: 25 }]

    const { server, calls } = makeServer()
    startProgressEmitter(server as never)

    await vi.advanceTimersByTimeAsync(1100)
    await vi.advanceTimersByTimeAsync(1100)
    await vi.advanceTimersByTimeAsync(1100)

    // Three poll cycles, but the row's `progress` never changed, so the
    // emitter sends exactly once.
    expect(calls.filter((c) => (c as { method: string }).method === "notifications/progress").length).toBe(1)
  })

  it("emits a final 100% notification on terminal status and removes the task", async () => {
    registerTask({ taskId: "j-3", userId: "u-1", kind: "audio" })
    mockJobsRow.rows = [{ id: "j-3", status: "completed", progress: 100 }]

    const { server, calls } = makeServer()
    startProgressEmitter(server as never)

    await vi.advanceTimersByTimeAsync(1100)

    const last = calls[calls.length - 1] as { params: { progress: number; message?: string } }
    expect(last.params.progress).toBe(100)
    expect(last.params.message).toContain("completed")

    // Subsequent polls should be cheap no-ops because the task fell out of
    // the registry.
    mockJobsRow.rows = []
    await vi.advanceTimersByTimeAsync(1100)
    expect(calls.length).toBe(1)
  })

  it("is a no-op when there are no tracked tasks (no DB query)", async () => {
    const { server, calls } = makeServer()
    startProgressEmitter(server as never)
    await vi.advanceTimersByTimeAsync(2200)
    expect(calls.length).toBe(0)
  })
})
