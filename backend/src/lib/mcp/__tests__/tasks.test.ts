import { describe, it, expect, beforeEach, vi } from "vitest"
import { GetTaskPayloadRequestSchema, GetTaskRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import {
  registerTask,
  registerTaskHandlers,
  getTask,
  cancelTask,
  completeTask,
  _resetRegistry,
} from "../tasks.js"

const taskDb = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  /** The `.in("status", [...])` guard markJobCancelled's fast CAS applies. */
  cancelStatusFilter: null as ReturnType<typeof vi.fn> | null,
  /** Rows the fast CAS reports as flipped — empty means "nothing to flip". */
  cancelFlipped: [] as Array<{ id: string }>,
  /** The single-job cancel helper the held path must delegate to. */
  cancelOwnedJob: vi.fn(),
}))

// `lib/cancel-job.js` transitively imports `lib/queue.js`, which opens a real
// IORedis handle at module load. Mocking it keeps this suite hermetic AND lets
// the held-cancel test assert delegation rather than a raw UPDATE.
vi.mock("../../cancel-job.js", () => ({
  cancelOwnedJob: taskDb.cancelOwnedJob,
}))

// Mock supabase so cancelTask -> markJobCancelled is a no-op in unit tests.
// The path is relative to tasks.ts, not to this test file.
vi.mock("../../supabase.js", () => {
  // markJobCancelled now guards with .in("status", [...]) so it can't clobber a
  // terminal job: update().eq().in() — the terminal .in resolves.
  // update().eq().in().select() — the CAS reports which rows it flipped.
  const casSelect = vi.fn(async () => ({ data: taskDb.cancelFlipped, error: null }))
  const inFn = vi.fn().mockReturnValue({ select: casSelect })
  const eq = vi.fn().mockReturnValue({ in: inFn })
  const update = vi.fn().mockReturnValue({ eq })
  taskDb.cancelStatusFilter = inFn
  const maybeSingle = vi.fn().mockImplementation(async () => ({ data: taskDb.row, error: null }))
  let selectChain: Record<string, unknown>
  selectChain = new Proxy({}, {
    get(_target, prop) {
      if (prop === "maybeSingle") return maybeSingle
      return vi.fn().mockReturnValue(selectChain)
    },
  })
  const select = vi.fn().mockReturnValue(selectChain)
  return {
    supabase: {
      from: vi.fn().mockImplementation(() => ({ update, select })),
    },
  }
})

describe("task lifecycle", () => {
  beforeEach(() => {
    _resetRegistry()
    taskDb.row = null
    taskDb.cancelFlipped = [{ id: "flipped" }]
    taskDb.cancelOwnedJob.mockReset().mockResolvedValue({ kind: "cancelled", analysisJobId: null })
  })

  it("registers a task and retrieves it", () => {
    const t = registerTask({ taskId: "j1", userId: "u1", kind: "image" })
    expect(getTask("j1")?.taskId).toBe("j1")
    expect(getTask("j1")?.userId).toBe("u1")
    expect(getTask("j1")?.kind).toBe("image")
    expect(t.abortController.signal.aborted).toBe(false)
  })

  it("returns null for an unknown taskId", () => {
    expect(getTask("nope")).toBeNull()
  })

  it("rejects cancel from a different user", async () => {
    registerTask({ taskId: "j2", userId: "u1", kind: "image" })
    const ok = await cancelTask("j2", "u-other")
    expect(ok).toBe(false)
    // Foreign cancel must not evict the task either.
    expect(getTask("j2")).not.toBeNull()
  })

  it("returns false when cancelling an unknown task", async () => {
    const ok = await cancelTask("unknown", "u1")
    expect(ok).toBe(false)
  })

  it("cancels the task for its owner and aborts the signal", async () => {
    const t = registerTask({ taskId: "j3", userId: "u1", kind: "video" })
    expect(t.abortController.signal.aborted).toBe(false)
    const ok = await cancelTask("j3", "u1")
    expect(ok).toBe(true)
    expect(t.abortController.signal.aborted).toBe(true)
    expect(getTask("j3")).toBeNull()
  })

  it("completes by removing from registry", () => {
    registerTask({ taskId: "j4", userId: "u1", kind: "audio" })
    completeTask("j4")
    expect(getTask("j4")).toBeNull()
  })

  it("redacts private remux bases from tasks/result output", async () => {
    taskDb.row = {
      status: "completed",
      output_data: {
        videoUrl: "https://public.example/final.mp4",
        pro: { unscoredUrl: "https://private.example/base.mp4" },
      },
      error_message: null,
    }
    registerTask({ taskId: "j-private", userId: "u1", kind: "video" })

    const handlers = new Map<unknown, (req: { params: { taskId: string } }) => Promise<unknown>>()
    const server = {
      server: {
        setRequestHandler: vi.fn((schema: unknown, handler: (req: { params: { taskId: string } }) => Promise<unknown>) => {
          handlers.set(schema, handler)
        }),
      },
    }
    registerTaskHandlers(server as never, () => "u1")

    const handler = handlers.get(GetTaskPayloadRequestSchema)
    expect(handler).toBeDefined()
    const result = await handler!({ params: { taskId: "j-private" } })

    expect(JSON.stringify(result)).toContain("https://public.example/final.mp4")
    expect(JSON.stringify(result)).not.toContain("unscoredUrl")
    expect(JSON.stringify(result)).not.toContain("private.example")
  })

  /** Wire the four tasks/* handlers and hand back the map, keyed by schema. */
  function handlersFor(userId: string) {
    const handlers = new Map<unknown, (req: { params: { taskId: string } }) => Promise<unknown>>()
    const server = {
      server: {
        setRequestHandler: vi.fn((schema: unknown, handler: (req: { params: { taskId: string } }) => Promise<unknown>) => {
          handlers.set(schema, handler)
        }),
      },
    }
    registerTaskHandlers(server as never, () => userId)
    return handlers
  }

  /**
   * A held job (spec 2026-09-03-job-policy-hook-design §6.4) is blocked on a
   * decision that is NOT the caller's to make. `working` (the `default:` arm)
   * leaves an agent polling a job that will never move on its own; the MCP task
   * enum's one non-working, non-terminal member says exactly the right thing.
   */
  it("tasks/get maps a pending_review job to input_required, not working", async () => {
    taskDb.row = { status: "pending_review", output_data: null, error_message: null }
    registerTask({ taskId: "j-held", userId: "u1", kind: "image" })

    const handler = handlersFor("u1").get(GetTaskRequestSchema)
    const result = (await handler!({ params: { taskId: "j-held" } })) as { status: string }

    expect(result.status).toBe("input_required")
  })

  it("tasks/result reports a held job as input_required instead of burning the 90s long-poll", async () => {
    taskDb.row = { status: "pending_review", output_data: null, error_message: null }
    registerTask({ taskId: "j-held-2", userId: "u1", kind: "image" })

    const handler = handlersFor("u1").get(GetTaskPayloadRequestSchema)
    const started = Date.now()
    const result = (await handler!({ params: { taskId: "j-held-2" } })) as { status: string; output?: unknown }

    expect(result.status).toBe("input_required")
    // No output is invented from a held row (output_data is NULL by contract).
    expect(result.output ?? null).toBeNull()
    expect(Date.now() - started).toBeLessThan(1000)
    // The task must STAY in the registry: the review resolves later and the
    // client re-calls tasks/result.
    expect(getTask("j-held-2")).not.toBeNull()
  })

  /**
   * D17 says a held job IS cancellable, but a bare `UPDATE … SET status =
   * 'cancelled'` is the wrong way to do it: no worker is left to refund the
   * reservation, so the credits stay `reserved` forever and the withheld media
   * is orphaned. The whole D17 sequence (flip + refund + owned-object delete +
   * a `withdrawn` decision) lives in `cancelOwnedJob`; MCP must delegate.
   */
  it("delegates a cancel the fast CAS could not flip to cancelOwnedJob (the held-job path)", async () => {
    // The narrow CAS matches nothing — the row is not pending/processing.
    taskDb.cancelFlipped = []
    registerTask({ taskId: "j-held-3", userId: "u1", kind: "image" })

    const ok = await cancelTask("j-held-3", "u1")

    expect(ok).toBe(true)
    expect(taskDb.cancelOwnedJob).toHaveBeenCalledWith("j-held-3", "u1")
    // The bare flip must stay narrow: a held row is never touched by it.
    expect(taskDb.cancelStatusFilter).toHaveBeenCalledWith("status", ["pending", "processing"])
  })

  it("does NOT reach cancelOwnedJob when the fast CAS already flipped the row", async () => {
    taskDb.cancelFlipped = [{ id: "j-live" }]
    registerTask({ taskId: "j-live", userId: "u1", kind: "image" })

    await cancelTask("j-live", "u1")

    expect(taskDb.cancelOwnedJob).not.toHaveBeenCalled()
  })

  it("registers timestamp and a fresh AbortController per task", () => {
    const t1 = registerTask({ taskId: "ja", userId: "u1", kind: "image" })
    const t2 = registerTask({ taskId: "jb", userId: "u1", kind: "image" })
    expect(t1.abortController).not.toBe(t2.abortController)
    expect(typeof t1.startedAt).toBe("number")
    expect(t1.startedAt).toBeLessThanOrEqual(Date.now())
  })
})
