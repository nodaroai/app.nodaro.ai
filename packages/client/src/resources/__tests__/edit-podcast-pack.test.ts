/**
 * The SDK's podcast pack (edit.podcastPack / edit.estimatePodcastPack):
 * several podcast tools on one recording, for one price. The other podcast
 * use-case verbs are edit-use-case.test.ts.
 */
import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NodaroError, PODCAST_PACK_TOOLS, USE_CASE_NODE_TYPES } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 202, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

function client(fetchMock: typeof fetch) {
  return createClient({
    baseUrl: "https://api.example.com",
    auth: new StaticTokenAuth("t"),
    fetch: fetchMock,
  })
}

const callOf = (fetchMock: ReturnType<typeof vi.fn>, i = 0) =>
  fetchMock.mock.calls[i]! as [string, { method: string; body: string; headers: Record<string, string> }]
const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, i = 0) => JSON.parse(callOf(fetchMock, i)[1].body)

const STARTED = {
  jobId: "pack-1",
  tools: [
    { tool: "tighten-episode", jobId: "job-t", executionId: "exec-t" },
    { tool: "clip-pack", jobId: "job-c", executionId: "exec-c" },
  ],
  durationSec: 512,
  units: 35,
}

describe("edit.podcastPack (decided 2026-11-18)", () => {
  it("posts the recording once and each tool's settings as given, with no Idempotency-Key unless asked", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(STARTED))
    const out = await client(fetchMock).edit.podcastPack({
      mediaUrl: "https://r2/ep.mp4",
      tools: { "tighten-episode": {}, "clip-pack": { count: 5, framing: null } },
    })
    const [url, init] = callOf(fetchMock)
    expect(url).toBe("https://api.example.com/v1/podcast-pack")
    expect(init.method).toBe("POST")
    expect(init.headers["Idempotency-Key"]).toBeUndefined()
    expect(bodyOf(fetchMock)).toEqual({
      mediaUrls: ["https://r2/ep.mp4"],
      tools: { "tighten-episode": {}, "clip-pack": { count: 5, framing: null } },
    })
    expect(out).toEqual(STARTED)
    if (out.deduped) throw new Error("a started pack is not deduped")
    expect(out.tools.map((t) => t.jobId)).toEqual(["job-t", "job-c"])
  })

  it("sends the recordings, the Master audio, the Cameras settings, the speakers' names and the job stamps, then an Idempotency-Key", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(STARTED))
    await client(fetchMock).edit.podcastPack(
      {
        mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
        masterAudioUrl: "https://r2/m.wav",
        cameras: { wide: 2, synced: true },
        speakerNames: { speaker_0: "Dana" },
        tools: { "speaker-layout": { targetAspect: "1:1" }, "episode-trailer": { formats: ["9:16"] } },
        workflowId: "00000000-0000-4000-8000-000000000001",
        nodeId: "node-1",
      },
      { idempotencyKey: "pack-key-1" },
    )
    expect(callOf(fetchMock)[1].headers["Idempotency-Key"]).toBe("pack-key-1")
    expect(bodyOf(fetchMock)).toEqual({
      mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
      masterAudioUrl: "https://r2/m.wav",
      cameras: { wide: 2, synced: true },
      speakerNames: { speaker_0: "Dana" },
      tools: { "speaker-layout": { targetAspect: "1:1" }, "episode-trailer": { formats: ["9:16"] } },
      workflowId: "00000000-0000-4000-8000-000000000001",
      nodeId: "node-1",
    })
  })

  it("answers the tools that did not start beside the ones that did", async () => {
    const answer = {
      ...STARTED,
      tools: [STARTED.tools[0]],
      notStarted: [{ tool: "clip-pack", error: { code: "internal_error", message: "clip-pack: failed to start", tool: "clip-pack" } }],
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(answer))
    const out = await client(fetchMock).edit.podcastPack({ mediaUrl: "https://r2/ep.mp4", tools: { "tighten-episode": {}, "clip-pack": {} } })
    if (out.deduped) throw new Error("a started pack is not deduped")
    expect(out.notStarted).toEqual(answer.notStarted)
  })

  it("a keyed retry answers the pack already started", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "pack-1", deduped: true }))
    const out = await client(fetchMock).edit.podcastPack({ mediaUrl: "https://r2/ep.mp4", tools: { "episode-chapters": {} } }, { idempotencyKey: "pack-key-1" })
    expect(out).toEqual({ jobId: "pack-1", deduped: true })
  })

  it("an empty tool list reaches the route, which refuses it", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(400, { error: { code: "validation_error", message: "Choose at least one tool" } }))
    await expect(client(fetchMock).edit.podcastPack({ mediaUrl: "https://r2/ep.mp4", tools: {} })).rejects.toBeInstanceOf(NodaroError)
    expect(bodyOf(fetchMock)).toEqual({ mediaUrls: ["https://r2/ep.mp4"], tools: {} })
  })

  it("a tool's own refusal comes back with the tool named in details", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(400, { error: { code: "validation_error", message: "Chapters: mediaUrls: at most 1", tool: "episode-chapters" } }),
    )
    const err = await client(fetchMock)
      .edit.podcastPack({ mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"], tools: { "episode-chapters": {} } })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    expect((err as NodaroError).code).toBe("validation_error")
    expect((err as NodaroError).details.tool).toBe("episode-chapters")
  })

  it("mediaUrl and mediaUrls together, or neither, reject with a TypeError before any request", async () => {
    const fetchMock = vi.fn()
    const edit = client(fetchMock).edit
    await expect(edit.podcastPack({ mediaUrl: "https://r2/a.mp4", mediaUrls: ["https://r2/b.mp4"], tools: { "clip-pack": {} } })).rejects.toThrow(
      new TypeError("pass mediaUrl or mediaUrls, not both"),
    )
    await expect(edit.estimatePodcastPack({ tools: { "clip-pack": {} } })).rejects.toThrow(new TypeError("pass mediaUrl or mediaUrls"))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("edit.estimatePodcastPack", () => {
  it("posts the same body to the estimate route and answers the quote", async () => {
    const quote = { tools: ["tighten-episode", "clip-pack"], durationSec: 512, units: 35, credits: 770 }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: quote }))
    const out = await client(fetchMock).edit.estimatePodcastPack({ mediaUrl: "https://r2/ep.mp4", tools: { "tighten-episode": {}, "clip-pack": { count: 3 } } })
    expect(out.data).toEqual(quote)
    const [url, init] = callOf(fetchMock)
    expect(url).toBe("https://api.example.com/v1/podcast-pack/estimate")
    expect(init.headers["Idempotency-Key"]).toBeUndefined()
    expect(bodyOf(fetchMock)).toEqual({ mediaUrls: ["https://r2/ep.mp4"], tools: { "tighten-episode": {}, "clip-pack": { count: 3 } } })
  })
})

describe("PODCAST_PACK_TOOLS", () => {
  it("names podcast use-case node types, each once", () => {
    expect(new Set(PODCAST_PACK_TOOLS).size).toBe(PODCAST_PACK_TOOLS.length)
    for (const tool of PODCAST_PACK_TOOLS) expect(USE_CASE_NODE_TYPES).toContain(tool)
  })
})

describe("edit.startPodcastPackTool", () => {
  it("starts a tool that did not start, under its pack: POST /v1/podcast-pack/:id/start with the tool", async () => {
    const answer = { jobId: "job-clips", executionId: "exec-clips", tool: "clip-pack" }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(answer))
    const out = await client(fetchMock).edit.startPodcastPackTool("pack-1", "clip-pack")
    expect(out).toEqual(answer)
    const [url, init] = callOf(fetchMock)
    expect(init.method).toBe("POST")
    expect(url).toMatch(/\/v1\/podcast-pack\/pack-1\/start$/)
    expect(bodyOf(fetchMock)).toEqual({ tool: "clip-pack" })
  })
})
