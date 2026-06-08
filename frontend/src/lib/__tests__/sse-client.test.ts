import { describe, it, expect, vi, afterEach } from "vitest"
import { streamRequest, streamGet, SseHttpError } from "../sse-client"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSSEResponse(
  chunks: string[],
  status = 200,
  statusText = "OK",
): Response {
  const encoder = new TextEncoder()
  let index = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]))
        index++
      } else {
        controller.close()
      }
    },
  })
  return new Response(stream, { status, statusText })
}

function mockErrorResponse(status: number, bodyText: string): Response {
  return new Response(bodyText, { status, statusText: "Error" })
}

function mockNullBodyResponse(): Response {
  const res = new Response(null, { status: 200 })
  Object.defineProperty(res, "body", { value: null })
  return res
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of gen) items.push(item)
  return items
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("streamRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uses relative URL when no baseUrl is provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mockSSEResponse(['data: {"type":"token","data":"hi"}\n\n']),
    )
    vi.stubGlobal("fetch", mockFetch)

    await collect(streamRequest("/v1/test", { body: { a: 1 } }))

    expect(mockFetch).toHaveBeenCalledWith(
      "/v1/test",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("prepends baseUrl when provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mockSSEResponse(['data: {"type":"token","data":"hi"}\n\n']),
    )
    vi.stubGlobal("fetch", mockFetch)

    await collect(
      streamRequest("/v1/test", {
        body: {},
        baseUrl: "http://localhost:8000",
      }),
    )

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8000/v1/test",
      expect.anything(),
    )
  })

  it("throws on non-ok response with status and body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockErrorResponse(500, "Internal Server Error"),
    ))

    await expect(
      collect(streamRequest("/v1/test", { body: {} })),
    ).rejects.toThrow("SSE request failed (500): Internal Server Error")
  })

  it("throws when response body is null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockNullBodyResponse()))

    await expect(
      collect(streamRequest("/v1/test", { body: {} })),
    ).rejects.toThrow("Response body is null")
  })

  it("parses a single SSE event", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockSSEResponse(['data: {"type":"token","data":"hello"}\n\n']),
    ))

    const events = await collect(streamRequest("/v1/test", { body: {} }))

    expect(events).toEqual([{ type: "token", data: "hello" }])
  })

  it("parses multiple events in one chunk", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockSSEResponse([
        'data: {"type":"token","data":"a"}\n\ndata: {"type":"token","data":"b"}\n\n',
      ]),
    ))

    const events = await collect(streamRequest("/v1/test", { body: {} }))

    expect(events).toEqual([
      { type: "token", data: "a" },
      { type: "token", data: "b" },
    ])
  })

  it("reassembles partial chunks split across reads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockSSEResponse([
        'data: {"type":"tok',
        'en","data":"split"}\n\n',
      ]),
    ))

    const events = await collect(streamRequest("/v1/test", { body: {} }))

    expect(events).toEqual([{ type: "token", data: "split" }])
  })

  it("skips SSE comments (lines starting with :)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockSSEResponse([
        ': keepalive\ndata: {"type":"token","data":"ok"}\n\n',
      ]),
    ))

    const events = await collect(streamRequest("/v1/test", { body: {} }))

    expect(events).toEqual([{ type: "token", data: "ok" }])
  })

  it("skips malformed JSON and continues parsing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockSSEResponse([
        'data: not-json\n\ndata: {"type":"token","data":"valid"}\n\n',
      ]),
    ))

    const events = await collect(streamRequest("/v1/test", { body: {} }))

    expect(events).toEqual([{ type: "token", data: "valid" }])
  })

  it("flushes remaining buffer after stream ends (no trailing newlines)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockSSEResponse(['data: {"type":"done","data":{"id":"1"}}']),
    ))

    const events = await collect(streamRequest("/v1/test", { body: {} }))

    expect(events).toEqual([{ type: "done", data: { id: "1" } }])
  })

  it("ignores empty parts between separators", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockSSEResponse(['\n\n\n\ndata: {"type":"token","data":"x"}\n\n\n\n']),
    ))

    const events = await collect(streamRequest("/v1/test", { body: {} }))

    expect(events).toEqual([{ type: "token", data: "x" }])
  })

  it("merges custom headers with Content-Type", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mockSSEResponse(['data: {"type":"token","data":"hi"}\n\n']),
    )
    vi.stubGlobal("fetch", mockFetch)

    await collect(
      streamRequest("/v1/test", {
        body: {},
        headers: { Authorization: "Bearer tok123" },
      }),
    )

    expect(mockFetch).toHaveBeenCalledWith(
      "/v1/test",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer tok123",
        },
      }),
    )
  })

  it("passes AbortSignal through to fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mockSSEResponse(['data: {"type":"token","data":"hi"}\n\n']),
    )
    vi.stubGlobal("fetch", mockFetch)

    const controller = new AbortController()
    await collect(
      streamRequest("/v1/test", { body: {}, signal: controller.signal }),
    )

    expect(mockFetch).toHaveBeenCalledWith(
      "/v1/test",
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it("throws SseHttpError carrying .status on a non-ok response (callers detect 404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockErrorResponse(404, "Execution not found"),
    ))

    const err = await collect(streamRequest("/v1/test", { body: {} })).catch((e) => e)
    expect(err).toBeInstanceOf(SseHttpError)
    expect((err as SseHttpError).status).toBe(404)
    // Message format is preserved for backward-compat.
    expect((err as SseHttpError).message).toContain("SSE request failed (404)")
  })
})

describe("streamGet", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("throws SseHttpError with .status=404 (the execution-stream not-found path)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockErrorResponse(404, "Execution not found"),
    ))

    const err = await collect(
      streamGet("/v1/workflow-executions/x/stream", {}),
    ).catch((e) => e)
    expect(err).toBeInstanceOf(SseHttpError)
    expect((err as SseHttpError).status).toBe(404)
  })
})
