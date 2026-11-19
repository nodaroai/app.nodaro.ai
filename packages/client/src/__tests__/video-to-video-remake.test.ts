/**
 * `nodes.run("video-to-video", …)` with a Video Remake engine as the provider
 * resolves that engine's QUOTE, typed apart from a started job; every other
 * call keeps the type it had. `runAndWait` refuses before anything is sent.
 */
import { describe, it, expect, expectTypeOf, vi } from "vitest"
import { createClient, StaticTokenAuth, NodaroError, isVideoToVideoRemakeQuote } from "../index.js"
import type {
  NodeQuote,
  RunNodeResult,
  VideoRemakeParams,
  VideoToVideoParams,
  VideoToVideoRemakeParams,
  VideoToVideoRemakeQuote,
  VideoToVideoRemakeRun,
} from "../index.js"

type FetchMock = ReturnType<typeof vi.fn> & typeof fetch

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
const client = (fetchMock: FetchMock) => createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
const sent = (fetchMock: FetchMock, call = 0) => {
  const [url, init] = fetchMock.mock.calls[call]! as [string, { method: string; body: string }]
  return { url, method: init.method, body: JSON.parse(init.body) as Record<string, unknown> }
}

const QUOTE: VideoToVideoRemakeQuote = {
  quoteOnly: true,
  message: "Nodaro Prism is a Video Remake engine: this is its price quote, and nothing was started.",
  videoRemake: {
    quote: {
      engine: "nodaro-prism",
      engineName: "Nodaro Prism",
      totalCredits: 480,
      expectedCredits: 300,
      breakdown: { base: 20, references: 0, motion: 460, motionExpected: 280 },
      settlesLower: true,
    },
    run: {
      method: "POST",
      path: "/v1/video-remake",
      body: { videoUrl: "https://cdn.test/clip.mp4", roles: [], postPrompt: "make it night", engine: "nodaro-prism" },
    },
  },
}

describe("types", () => {
  it("a Video Remake engine resolves the quote; any other provider resolves what it did", () => {
    const nodes = client(vi.fn() as unknown as FetchMock).nodes
    const remake = () => nodes.run("video-to-video", { videoUrl: "u", prompt: "p", provider: "nodaro-pulse" })
    const edit = () => nodes.run("video-to-video", { videoUrl: "u", prompt: "p", provider: "seedance-2-5" })
    const unnamed = () => nodes.run("video-to-video", { videoUrl: "u", prompt: "p" })
    expectTypeOf(remake).returns.resolves.toEqualTypeOf<VideoToVideoRemakeQuote>()
    expectTypeOf(edit).returns.resolves.toEqualTypeOf<RunNodeResult>()
    expectTypeOf(unnamed).returns.resolves.toEqualTypeOf<RunNodeResult>()
    expectTypeOf(() => nodes.quote("video-to-video", { videoUrl: "u", prompt: "p", provider: "nodaro-prism" })).returns.resolves.toEqualTypeOf<NodeQuote>()
  })

  it("the quote carries no jobId, and its run body is a Video Remake run", () => {
    expectTypeOf<VideoToVideoRemakeQuote["jobId"]>().toEqualTypeOf<undefined>()
    expectTypeOf<VideoToVideoRemakeQuote["quoteOnly"]>().toEqualTypeOf<true>()
    expectTypeOf<VideoToVideoRemakeRun>().toMatchTypeOf<VideoRemakeParams>()
    // The engines are not Video to Video models: the node's params do not take them.
    expectTypeOf<"nodaro-prism">().not.toMatchTypeOf<NonNullable<VideoToVideoParams["provider"]>>()
    const params: VideoToVideoRemakeParams = { videoUrl: "u", prompt: "p", provider: "nodaro-prism", resolution: "720p", draft: false }
    expect(params.provider).toBe("nodaro-prism")
  })
})

describe("nodes.run / quote / runAndWait", () => {
  it("run posts the body to /v1/video-to-video and resolves the quote, which the guard recognises", async () => {
    const fetchMock = vi.fn(() => mockOk(QUOTE)) as unknown as FetchMock
    const result = await client(fetchMock).nodes.run("video-to-video", { videoUrl: "https://cdn.test/clip.mp4", prompt: "make it night", provider: "nodaro-prism" })
    expect(sent(fetchMock)).toEqual({
      url: "https://api.example.com/v1/video-to-video",
      method: "POST",
      body: { videoUrl: "https://cdn.test/clip.mp4", prompt: "make it night", provider: "nodaro-prism" },
    })
    expect(result.quoteOnly).toBe(true)
    expect(result.videoRemake.quote.totalCredits).toBe(480)
    expect(isVideoToVideoRemakeQuote(result)).toBe(true)
    expect(isVideoToVideoRemakeQuote({ jobId: "job-1" })).toBe(false)
  })

  it("the quoted run goes to client.videoRemake.run as it is", async () => {
    const fetchMock = vi.fn((url: string) => mockOk(url.endsWith("/v1/video-remake") ? { jobId: "job-9" } : QUOTE)) as unknown as FetchMock
    const c = client(fetchMock)
    const quoted = await c.nodes.run("video-to-video", { videoUrl: "https://cdn.test/clip.mp4", prompt: "make it night", provider: "nodaro-prism" })
    const started = await c.videoRemake.run(quoted.videoRemake.run.body)
    expect(started.jobId).toBe("job-9")
    expect(sent(fetchMock, 1)).toEqual({ url: "https://api.example.com/v1/video-remake", method: "POST", body: QUOTE.videoRemake.run.body })
  })

  it("quote sends the same params to /v1/quote", async () => {
    const fetchMock = vi.fn(() => mockOk({ data: { identifier: "nodaro-pulse", reserve: 220, adjustments: [], warnings: [{ code: "quote_only_provider", message: "m" }] } })) as unknown as FetchMock
    const quote = await client(fetchMock).nodes.quote("video-to-video", { videoUrl: "u", prompt: "p", provider: "nodaro-pulse" })
    expect(sent(fetchMock).body).toEqual({ type: "video-to-video", params: { videoUrl: "u", prompt: "p", provider: "nodaro-pulse" } })
    expect(quote.reserve).toBe(220)
  })

  it.each(["nodaro-prism", "nodaro-pulse"])("runAndWait with %s is refused before anything is sent", async (provider) => {
    const fetchMock = vi.fn(() => mockOk(QUOTE)) as unknown as FetchMock
    const err = await client(fetchMock).nodes.runAndWait("video-to-video", { videoUrl: "u", prompt: "p", provider } as Record<string, unknown>).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    expect((err as NodaroError).code).toBe("quote_only_provider")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
