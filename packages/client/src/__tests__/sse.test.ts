import { describe, it, expect } from "vitest"
import { readSseStream } from "../sse.js"
import { NodaroError } from "../errors.js"

/** A Response whose body streams the given raw chunks, remembering a cancel. */
function sseResponse(chunks: string[], state: { cancelled?: boolean } = {}) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
    cancel() {
      state.cancelled = true
    },
  })
  return { ok: true, status: 200, body } as unknown as Response
}

async function collect<T>(res: Response): Promise<T[]> {
  const out: T[] = []
  for await (const ev of readSseStream<T>(res)) out.push(ev)
  return out
}

describe("readSseStream", () => {
  it("yields the JSON of every `data:` line, frame by frame", async () => {
    const events = await collect<{ type: string }>(
      sseResponse([
        'data: {"type":"metadata"}\n\n',
        'data: {"type":"token"}\n\ndata: {"type":"done"}\n\n',
      ]),
    )
    expect(events).toEqual([{ type: "metadata" }, { type: "token" }, { type: "done" }])
  })

  it("reassembles a frame split across chunk boundaries", async () => {
    const events = await collect<{ type: string; n: number }>(
      sseResponse(['data: {"type":"tok', 'en","n":7}\n', "\n"]),
    )
    expect(events).toEqual([{ type: "token", n: 7 }])
  })

  it("yields only `data:` lines — a keepalive comment or another SSE field is not an event", async () => {
    const events = await collect<{ type: string }>(
      sseResponse([
        ": keepalive\n\n",
        'id: 4\n{"type":"sneak"}\ndata: {"type":"token"}\n\n',
      ]),
    )
    expect(events).toEqual([{ type: "token" }])
  })

  it("skips a malformed data line and keeps reading the stream", async () => {
    const events = await collect<{ type: string }>(
      sseResponse(["data: {not json\n\n", 'data: {"type":"done"}\n\n']),
    )
    expect(events).toEqual([{ type: "done" }])
  })

  it("cancels the body when the consumer stops early", async () => {
    const state: { cancelled?: boolean } = {}
    const res = sseResponse(['data: {"type":"token"}\n\n', 'data: {"type":"done"}\n\n'], state)
    for await (const ev of readSseStream<{ type: string }>(res)) {
      expect(ev.type).toBe("token")
      break
    }
    expect(state.cancelled).toBe(true)
  })

  it("throws the typed error on a non-OK response", async () => {
    const res = {
      ok: false,
      status: 404,
      json: async () => ({ error: { code: "not_found", message: "Thread not found" } }),
    } as unknown as Response
    await expect(collect(res)).rejects.toThrow("Thread not found")
  })

  it("throws a labelled empty_stream error when the response has no body", async () => {
    const res = { ok: true, status: 200, body: null } as unknown as Response
    const iterate = async () => {
      for await (const ev of readSseStream(res, { label: "copilot stream" })) void ev
    }
    await expect(iterate()).rejects.toMatchObject({ code: "empty_stream" })
    await expect(iterate()).rejects.toThrow("copilot stream has no response body")
    await expect(iterate()).rejects.toBeInstanceOf(NodaroError)
  })
})
