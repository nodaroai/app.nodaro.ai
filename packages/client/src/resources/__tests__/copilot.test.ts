import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { CopilotStreamFrame, CopilotThread } from "../copilot.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

function make(fetchMock: ReturnType<typeof vi.fn>, timeoutMs?: number) {
  return createClient({
    baseUrl: "https://api.example.com",
    auth: new StaticTokenAuth("t"),
    fetch: fetchMock as unknown as typeof fetch,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  })
}

/** A Response whose body is an SSE stream emitting the given raw chunks. */
function mockSse(chunks: string[]) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return Promise.resolve({ ok: true, status: 200, body } as unknown as Response)
}

/** One `data: {type,data}` frame, as `createSSEStream` writes it. */
function frame(type: string, data: unknown): string {
  return `data: ${JSON.stringify({ type, data })}\n\n`
}

const THREAD_ROW = {
  id: "th-1",
  workflowId: "wf-1",
  runMode: "ask" as const,
  modelTier: "standard" as const,
  allowPublishing: false,
  autoRunLimitCredits: 50,
  userTurnCount: 3,
  lastMessageAt: "2026-09-09T00:00:00.000Z",
  createdAt: "2026-09-08T00:00:00.000Z",
}

async function collectFrames(client: ReturnType<typeof make>, threadId = "th-1", opts: { message?: string; signal?: AbortSignal } = {}) {
  const frames: CopilotStreamFrame[] = []
  for await (const f of client.copilot.stream(threadId, { message: opts.message ?? "hi", ...(opts.signal ? { signal: opts.signal } : {}) })) {
    frames.push(f)
  }
  return frames
}

describe("copilot threads", () => {
  it("create() POSTs /v1/copilot/threads and returns the thread + its workflow", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ data: { thread: THREAD_ROW, workflow: { id: "wf-1", projectId: "pr-1", name: "Untitled", version: 4 } } }),
    )
    const c = make(fetchMock)
    const { data } = await c.copilot.create({ prompt: "make me a trailer", name: "Trailer" })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/copilot/threads")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ prompt: "make me a trailer", name: "Trailer" })
    expect(data.thread).toEqual(THREAD_ROW)
    expect(data.workflow.version).toBe(4)
  })

  it("list() GETs the active thread for a workflow, and reads `null` as none", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { thread: null } }))
    const c = make(fetchMock)
    const { data } = await c.copilot.list({ workflowId: "wf-9" })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/copilot/threads?workflowId=wf-9")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(data.thread).toBeNull()
  })

  it("get() GETs one thread with its messages, paged by after/limit", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({
        data: {
          thread: { ...THREAD_ROW, status: "running", activeTurnId: "tu-2" },
          messages: [{ id: "m-1", seq: 1, turnId: "tu-1", role: "user", createdAt: "2026-09-09T00:00:00.000Z", parts: [{ kind: "text", text: "hi" }] }],
        },
      }),
    )
    const c = make(fetchMock)
    const { data } = await c.copilot.get("th-1", { after: 1, limit: 50 })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/copilot/threads/th-1?after=1&limit=50")
    expect(data.thread.status).toBe("running")
    expect(data.messages[0]?.parts[0]).toEqual({ kind: "text", text: "hi" })
  })

  it("archive() DELETEs the thread", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { archived: true } }))
    const c = make(fetchMock)
    const { data } = await c.copilot.archive("th-1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/copilot/threads/th-1")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("DELETE")
    expect(data.archived).toBe(true)
  })

  it("cancel() POSTs the cancel route and names the turn it stopped", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { cancelling: true, turnId: "tu-2" } }))
    const c = make(fetchMock)
    const { data } = await c.copilot.cancel("th-1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/copilot/threads/th-1/cancel")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("POST")
    expect(data.turnId).toBe("tu-2")
  })
})

describe("copilot thread surface (optional — absent is a value)", () => {
  it('reads a thread answered with surface "studio"', async () => {
    const row = { ...THREAD_ROW, surface: "studio" }
    const c = make(vi.fn().mockReturnValueOnce(mockOk({ data: { thread: row } })))
    const { data } = await c.copilot.list({ workflowId: "wf-1" })
    const thread = data.thread as CopilotThread
    expect(thread.surface).toBe("studio")
    expect(thread).toEqual(row)
  })

  it('reads a thread answered with surface "workflow"', async () => {
    const row = { ...THREAD_ROW, surface: "workflow" }
    const c = make(vi.fn().mockReturnValueOnce(mockOk({ data: { thread: row } })))
    const { data } = await c.copilot.list({ workflowId: "wf-1" })
    const thread = data.thread as CopilotThread
    expect(thread.surface).toBe("workflow")
    expect(thread).toEqual(row)
  })

  it("reads a thread from a deployment that predates the column — no surface key, not a default", async () => {
    const c = make(vi.fn().mockReturnValueOnce(mockOk({ data: { thread: THREAD_ROW } })))
    const { data } = await c.copilot.list({ workflowId: "wf-1" })
    const thread = data.thread as CopilotThread
    expect(thread.surface).toBeUndefined()
    expect(Object.hasOwn(thread, "surface")).toBe(false)
    expect(thread).toEqual(THREAD_ROW)
  })
})

describe("copilot stream", () => {
  it("POSTs the message to the thread's messages route with auth and yields the turn's frames", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockSse([
        frame("metadata", { threadId: "th-1", turnId: "tu-9", jobId: "job-1", model: "m", baseVersion: 4, runMode: "ask", autoRunLimitCredits: 50 }),
        frame("token", { text: "Hel" }) + frame("token", { text: "lo" }),
        frame("done", { turnId: "tu-9", messageId: "m-2", status: "completed", finalVersion: 5 }),
      ]),
    )
    const c = make(fetchMock)
    const frames: CopilotStreamFrame[] = []
    for await (const f of c.copilot.stream("th-1", { message: "hi", baseVersion: 4, tier: "premium" })) frames.push(f)

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/copilot/threads/th-1/messages")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string; headers: Record<string, string> }
    expect(init.method).toBe("POST")
    expect(init.headers.Authorization).toBe("Bearer t")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(JSON.parse(init.body)).toEqual({ message: "hi", baseVersion: 4, tier: "premium" })
    expect(frames.map((f) => f.type)).toEqual(["metadata", "token", "token", "done"])
    const first = frames[0]
    expect(first?.type === "metadata" && first.data.turnId).toBe("tu-9")
  })

  it('reads a metadata frame carrying surface "studio"', async () => {
    const c = make(vi.fn().mockReturnValueOnce(mockSse([frame("metadata", { threadId: "th-1", turnId: "tu-1", jobId: "j", model: "m", baseVersion: null, runMode: "ask", autoRunLimitCredits: 0, surface: "studio" })])))
    const frames = await collectFrames(c)
    const meta = frames[0]
    expect(meta?.type).toBe("metadata")
    expect(meta?.type === "metadata" && meta.data.surface).toBe("studio")
  })

  it('reads a metadata frame carrying surface "workflow"', async () => {
    const c = make(vi.fn().mockReturnValueOnce(mockSse([frame("metadata", { threadId: "th-1", turnId: "tu-1", jobId: "j", model: "m", baseVersion: null, runMode: "ask", autoRunLimitCredits: 0, surface: "workflow" })])))
    const frames = await collectFrames(c)
    const meta = frames[0]
    expect(meta?.type === "metadata" && meta.data.surface).toBe("workflow")
  })

  it("reads a metadata frame from a deployment that predates surface — no key, not a default", async () => {
    const c = make(vi.fn().mockReturnValueOnce(mockSse([frame("metadata", { threadId: "th-1", turnId: "tu-1", jobId: "j", model: "m", baseVersion: null, runMode: "ask", autoRunLimitCredits: 0 })])))
    const frames = await collectFrames(c)
    const meta = frames[0]
    expect(meta?.type).toBe("metadata")
    expect(meta?.type === "metadata" && meta.data.surface).toBeUndefined()
    expect(meta?.type === "metadata" && Object.hasOwn(meta.data, "surface")).toBe(false)
  })

  it("ignores an event type it does not know, and never throws on one", async () => {
    const c = make(
      vi.fn().mockReturnValueOnce(
        mockSse([
          frame("token", { text: "a" }),
          frame("some_future_thing", { whatever: true }),
          frame("done", { turnId: "tu-1", messageId: null, status: "completed", finalVersion: null }),
        ]),
      ),
    )
    const frames = await collectFrames(c)
    expect(frames.map((f) => f.type)).toEqual(["token", "done"])
  })

  it("keeps fields it does not model on a frame it does", async () => {
    const c = make(
      vi.fn().mockReturnValueOnce(
        mockSse([frame("done", { turnId: "tu-1", messageId: null, status: "completed", finalVersion: null, unmodelledByThisSdk: 42 })]),
      ),
    )
    const frames = await collectFrames(c)
    expect(frames[0]?.data).toEqual({ turnId: "tu-1", messageId: null, status: "completed", finalVersion: null, unmodelledByThisSdk: 42 })
  })

  it("ends the stream when the caller's abort signal fires", async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      if (init.signal?.aborted) return Promise.reject(new DOMException("This operation was aborted", "AbortError"))
      return mockSse([frame("token", { text: "a" })])
    })
    const c = make(fetchMock as unknown as ReturnType<typeof vi.fn>)
    const ac = new AbortController()
    ac.abort()
    await expect(collectFrames(c, "th-1", { signal: ac.signal })).rejects.toThrow(/abort/i)
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal).toBeDefined()
  })

  it("is not killed by the client's request timeout — a turn runs longer than one exchange", async () => {
    const encoder = new TextEncoder()
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const timer = setTimeout(() => {
            controller.enqueue(encoder.encode(frame("done", { turnId: "tu-1", messageId: null, status: "completed", finalVersion: null })))
            controller.close()
          }, 60)
          init.signal?.addEventListener("abort", () => {
            clearTimeout(timer)
            controller.error(new DOMException("This operation was aborted", "AbortError"))
          })
        },
      })
      return Promise.resolve({ ok: true, status: 200, body } as unknown as Response)
    })
    // A 5ms request timer would kill this turn 55ms before its first frame.
    const c = make(fetchMock as unknown as ReturnType<typeof vi.fn>, 5)
    const frames = await collectFrames(c)
    expect(frames.map((f) => f.type)).toEqual(["done"])
  })
})
