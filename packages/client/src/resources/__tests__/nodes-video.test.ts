import { describe, it, expect, expectTypeOf, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { NodeQuote, RunNodeResult, VideoToVideoParams } from "../../index.js"

type FetchMock = ReturnType<typeof vi.fn> & typeof fetch

function fetchAnswering(body: unknown): FetchMock {
  return vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response),
  ) as unknown as FetchMock
}

function client(fetchMock: FetchMock) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
}

function call(fetchMock: FetchMock, i: number) {
  const [url, init] = fetchMock.mock.calls[i] as [string, { method: string; body?: string; headers: Record<string, string> }]
  return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers }
}

const V2V: VideoToVideoParams = { videoUrl: "https://cdn.example.com/clip.mp4", prompt: "make it noir", provider: "luma-modify" }

describe("nodes.run — the typed video lanes take an Idempotency-Key", () => {
  it.each([
    ["text-to-video", "/v1/text-to-video", { prompt: "a fox" }],
    ["generate-video", "/v1/generate-video", { prompt: "a fox" }],
    ["video-to-video", "/v1/video-to-video", V2V],
  ] as const)("%s sends the key on POST %s", async (type, path, params) => {
    const fetchMock = fetchAnswering({ jobId: "job-1" })
    // Each literal type picks its typed overload; the third argument is accepted on all three.
    const res = await client(fetchMock).nodes.run(type as "text-to-video", params as never, { idempotencyKey: "k-1" })
    expect(res).toEqual({ jobId: "job-1" })
    const sent = call(fetchMock, 0)
    expect(sent.url).toBe(`https://api.example.com${path}`)
    expect(sent.headers["Idempotency-Key"]).toBe("k-1")
  })

  it("sends no key when none is given", async () => {
    const fetchMock = fetchAnswering({ jobId: "job-1" })
    await client(fetchMock).nodes.run("video-to-video", V2V)
    expect(call(fetchMock, 0).headers["Idempotency-Key"]).toBeUndefined()
    expect(call(fetchMock, 0).body).toEqual(V2V)
  })

  it("types video-to-video and accepts options on every video overload", () => {
    const nodes = client(fetchAnswering({})).nodes
    expectTypeOf(nodes.run("video-to-video", V2V, { idempotencyKey: "k" })).toEqualTypeOf<Promise<RunNodeResult>>()
    expectTypeOf(nodes.run("text-to-video", { prompt: "x" }, { idempotencyKey: "k" })).toEqualTypeOf<Promise<RunNodeResult>>()
    expectTypeOf(nodes.run("generate-video", {}, { idempotencyKey: "k" })).toEqualTypeOf<Promise<RunNodeResult>>()
    expectTypeOf<VideoToVideoParams["provider"]>().toEqualTypeOf<
      "wan" | "wan-flash" | "wan-videoedit" | "luma-modify" | "runway-aleph" | "happyhorse-edit" | "seedance-2-5" | undefined
    >()
    expectTypeOf<VideoToVideoParams["videoUrl"]>().toEqualTypeOf<string>()
  })
})

describe("nodes.quote", () => {
  const QUOTE: NodeQuote = {
    identifier: "seedance-2-5:auto:480p-ref",
    reserve: 1200,
    expected: 800,
    adjustments: [{ code: "ref_video_length", message: "Priced on a 10s reference clip." }],
    warnings: [],
  }

  it("posts { type, params } to /v1/quote and resolves the quote as sent", async () => {
    const fetchMock = fetchAnswering({ data: QUOTE })
    const params = { prompt: "edit it", provider: "seedance-2-5", duration: -1, referenceVideoUrls: ["https://cdn.example.com/a.mp4"] }
    const quote = await client(fetchMock).nodes.quote("text-to-video", params)
    expect(quote).toEqual(QUOTE)
    const sent = call(fetchMock, 0)
    expect(sent.url).toBe("https://api.example.com/v1/quote")
    expect(sent.method).toBe("POST")
    expect(sent.body).toEqual({ type: "text-to-video", params })
  })

  it("is typed for the video lanes and generic for the rest", () => {
    const nodes = client(fetchAnswering(QUOTE)).nodes
    expectTypeOf(nodes.quote("video-to-video", V2V)).toEqualTypeOf<Promise<NodeQuote>>()
    expectTypeOf(nodes.quote("generate-image", { prompt: "x" })).toEqualTypeOf<Promise<NodeQuote>>()
  })
})
