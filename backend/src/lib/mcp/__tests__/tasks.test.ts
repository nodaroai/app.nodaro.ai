import { describe, it, expect, beforeEach, vi } from "vitest"
import { GetTaskPayloadRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import {
  registerTask,
  registerTaskHandlers,
  getTask,
  cancelTask,
  completeTask,
  _resetRegistry,
} from "../tasks.js"

const taskDb = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }))

// Mock supabase so cancelTask -> markJobCancelled is a no-op in unit tests.
// The path is relative to tasks.ts, not to this test file.
vi.mock("../../supabase.js", () => {
  // markJobCancelled now guards with .in("status", [...]) so it can't clobber a
  // terminal job: update().eq().in() — the terminal .in resolves.
  const inFn = vi.fn().mockResolvedValue({ data: null, error: null })
  const eq = vi.fn().mockReturnValue({ in: inFn })
  const update = vi.fn().mockReturnValue({ eq })
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

  it("registers timestamp and a fresh AbortController per task", () => {
    const t1 = registerTask({ taskId: "ja", userId: "u1", kind: "image" })
    const t2 = registerTask({ taskId: "jb", userId: "u1", kind: "image" })
    expect(t1.abortController).not.toBe(t2.abortController)
    expect(typeof t1.startedAt).toBe("number")
    expect(t1.startedAt).toBeLessThanOrEqual(Date.now())
  })
})
