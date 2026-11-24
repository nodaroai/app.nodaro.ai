import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NodaroError } from "../../index.js"
import type { EditVideoProParams, NodeQuote, RelightSwitchJobOutput, RelightSwitchParams } from "../../index.js"

function answer(status: number, body: unknown) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response)
}

function clientOf(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock as unknown as typeof fetch })
}

function call(fetchMock: ReturnType<typeof vi.fn>, n = 0) {
  const [url, init] = fetchMock.mock.calls[n] as [string, { method: string; body?: string }]
  return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined }
}

const RELIGHT: RelightSwitchParams = {
  videoUrl: "https://cdn.example.com/clip.mp4",
  alphaMode: "select",
  maskUrl: "https://cdn.example.com/mask.png",
  alphaKeyframeIndex: 12,
  referenceImageUrl: "https://cdn.example.com/look.jpg",
  prompt: "golden hour, warm rim light",
  maxResolution: 720,
  origin: "video-player",
}

const EDIT: EditVideoProParams = {
  videoUrl: "https://cdn.example.com/clip.mp4",
  spanStart: 5,
  spanEnd: 13,
  prompt: "the dog jumps into the pool",
  provider: "seedance-2-fast",
  referenceImageUrls: ["https://cdn.example.com/dog.jpg"],
  origin: "video-player",
}

const QUOTE: NodeQuote = { identifier: "x", reserve: 120, adjustments: [], warnings: [{ code: "settles_to_actual", message: "m" }] }

describe("Relight & Switch and Edit Video Pro through nodes.run / nodes.quote", () => {
  it("run posts each body, as given, to the node's own route", async () => {
    const fetchMock = vi.fn(() => answer(200, { jobId: "j1" }))
    const client = clientOf(fetchMock)
    expect(await client.nodes.run("switchx", RELIGHT)).toEqual({ jobId: "j1" })
    expect(await client.nodes.run("edit-video-pro", EDIT)).toEqual({ jobId: "j1" })
    expect(call(fetchMock, 0)).toEqual({ url: "https://api.example.com/v1/switchx", method: "POST", body: RELIGHT })
    expect(call(fetchMock, 1)).toEqual({ url: "https://api.example.com/v1/edit-video-pro", method: "POST", body: EDIT })
  })

  it("quote sends the same body with the node's type and returns the quote", async () => {
    const fetchMock = vi.fn(() => answer(200, { data: QUOTE }))
    const client = clientOf(fetchMock)
    expect(await client.nodes.quote("switchx", RELIGHT)).toEqual(QUOTE)
    expect(await client.nodes.quote("edit-video-pro", EDIT)).toEqual(QUOTE)
    expect(call(fetchMock, 0)).toEqual({ url: "https://api.example.com/v1/quote", method: "POST", body: { type: "switchx", params: RELIGHT } })
    expect(call(fetchMock, 1).body).toEqual({ type: "edit-video-pro", params: EDIT })
  })

  it.each([
    ["too many frames", { error: { code: "VIDEO_TOO_MANY_FRAMES", message: "Source has 400 frames (max 240). Trim it first." } }, "VIDEO_TOO_MANY_FRAMES", "Source has 400 frames (max 240). Trim it first."],
    ["a mode with no mask", { error: { code: "MISSING_ALPHA", message: "This mode needs a mask." } }, "MISSING_ALPHA", "This mode needs a mask."],
    ["a span past the video's end", { error: { code: "span_exceeds_source", message: "The span end (40s) is beyond the end of the video (30.0s)" } }, "span_exceeds_source", "The span end (40s) is beyond the end of the video (30.0s)"],
    // An older server's answers for Edit Video Pro, read as the same codes and sentences.
    ["a span past the end, older shape", { error: "span_exceeds_source", message: "The span end (40s) is beyond the end of the video (30.0s)" }, "span_exceeds_source", "The span end (40s) is beyond the end of the video (30.0s)"],
    ["a span too short, older shape", { message: "spanEnd: Replace span must be at least 4 seconds", issues: [{ path: "spanEnd", message: "Replace span must be at least 4 seconds" }] }, "validation_error", "spanEnd: Replace span must be at least 4 seconds"],
  ] as const)("a limit comes back as its own code and a sentence: %s", async (_name, body, code, message) => {
    const client = clientOf(vi.fn(() => answer(400, body)))
    const err = await client.nodes.run("edit-video-pro", EDIT).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    expect((err as NodaroError).code).toBe(code)
    expect((err as NodaroError).message).toBe(message)
    expect((err as NodaroError).status).toBe(400)
  })

  it("the types hold: a mode outside the four, or a span with no end, does not compile", () => {
    // @ts-expect-error not one of auto / fill / select / custom
    const badMode: RelightSwitchParams = { videoUrl: "https://x/y.mp4", alphaMode: "everything" }
    // @ts-expect-error spanEnd is required
    const noEnd: EditVideoProParams = { videoUrl: "https://x/y.mp4", spanStart: 0, prompt: "p" }
    const out: RelightSwitchJobOutput = { videoUrl: "https://x/out.mp4", thumbnailUrl: "https://x/t.jpg", sourceTrimmedToFrames: 240 }
    expect([badMode, noEnd, out].length).toBe(3)
  })
})
