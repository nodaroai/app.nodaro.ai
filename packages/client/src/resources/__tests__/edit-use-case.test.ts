/**
 * The SDK's podcast use-case verbs (edit.*): Tighten Episode on several
 * recordings, Chapters, Trailer and Clip Pack. The edit resource's other verbs,
 * and Tighten's single-recording run, estimate and continuation, are edit.test.ts.
 */
import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NodaroError } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
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

describe("edit.tightenEpisode's framing source (decided 2026-10-17/20)", () => {
  const bodyOf = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)
  it("sends framingSource with the framing, for the run and its estimate", async () => {
    const framing = { aspect: "9:16", layout: "stacked" } as const
    for (const framingSource of ["auto", "static", "tracking"] as const) {
      const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1" }))
      await client(fetchMock).edit.tightenEpisode({ mediaUrl: "https://r2/a.mp4", framing, framingSource })
      expect(bodyOf(fetchMock)).toEqual({ mediaUrls: ["https://r2/a.mp4"], framing, framingSource })
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { totalCredits: 1, stepsCredits: 0, feeCredits: 1, durationSec: null } }))
    await client(fetchMock).edit.estimateTightenEpisode({ mediaUrl: "https://r2/a.mp4", framing, framingSource: "tracking" })
    expect(bodyOf(fetchMock)).toEqual({ mediaUrls: ["https://r2/a.mp4"], framing, framingSource: "tracking" })
  })
})

describe("edit.tightenEpisode on several recordings (decided 2026-10-19)", () => {
  const bodyOf = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)

  it("sends the recordings in order, the Master audio and the Cameras settings", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1" }))
    await client(fetchMock).edit.tightenEpisode({
      mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
      masterAudioUrl: "https://r2/m.wav",
      cameras: { wide: 2, synced: false, speakerCameras: { "1": 1 } },
    })
    expect(bodyOf(fetchMock)).toEqual({
      mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
      masterAudioUrl: "https://r2/m.wav",
      cameras: { wide: 2, synced: false, speakerCameras: { "1": 1 } },
    })
  })

  it("the estimate takes the same body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { totalCredits: 1, stepsCredits: 0, feeCredits: 1, durationSec: null } }))
    await client(fetchMock).edit.estimateTightenEpisode({ mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"], cameras: { wide: 2 } })
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.com/v1/tighten-episode/estimate")
    expect(bodyOf(fetchMock)).toEqual({ mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"], cameras: { wide: 2 } })
  })

  it("mediaUrl is still one recording", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1" }))
    await client(fetchMock).edit.tightenEpisode({ mediaUrl: "https://r2/a.mp4" })
    expect(bodyOf(fetchMock)).toEqual({ mediaUrls: ["https://r2/a.mp4"] })
  })

  it("mediaUrl and mediaUrls together, or neither, reject with a TypeError before any request (never a sync throw)", async () => {
    const fetchMock = vi.fn()
    const edit = client(fetchMock).edit
    const both = edit.tightenEpisode({ mediaUrl: "https://r2/a.mp4", mediaUrls: ["https://r2/b.mp4"] })
    await expect(both).rejects.toThrow(new TypeError("pass mediaUrl or mediaUrls, not both"))
    await expect(both).rejects.toBeInstanceOf(TypeError)
    await expect(edit.estimateTightenEpisode({ masterAudioUrl: "https://r2/m.wav" })).rejects.toThrow(new TypeError("pass mediaUrl or mediaUrls"))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("edit.episodeTrailer on several recordings (decided 2026-10-20)", () => {
  const bodyOf = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)

  it("sends the recordings in order, the Master audio and the Cameras settings, then the formats", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1" }))
    await client(fetchMock).edit.episodeTrailer({
      mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
      masterAudioUrl: "https://r2/m.wav",
      cameras: { wide: 2, speakerCameras: { "1": 1 } },
      formats: ["16:9"],
    })
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.com/v1/episode-trailer")
    expect(bodyOf(fetchMock)).toEqual({
      mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
      masterAudioUrl: "https://r2/m.wav",
      cameras: { wide: 2, speakerCameras: { "1": 1 } },
      formats: ["16:9"],
    })
  })

  it("the estimate takes the same body; mediaUrl is still one recording, with nothing more sent", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(mockOk({ data: { totalCredits: 1, stepsCredits: 0, feeCredits: 1, durationSec: null } }))
      .mockReturnValueOnce(mockOk({ jobId: "job-1" }))
    await client(fetchMock).edit.estimateEpisodeTrailer({ mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"] })
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.com/v1/episode-trailer/estimate")
    expect(bodyOf(fetchMock)).toEqual({ mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"] })
    await client(fetchMock).edit.episodeTrailer({ mediaUrl: "https://r2/a.mp4" })
    expect(JSON.parse((fetchMock.mock.calls[1]![1] as { body: string }).body)).toEqual({ mediaUrls: ["https://r2/a.mp4"] })
  })

  it("mediaUrl and mediaUrls together, or neither, reject with a TypeError before any request", async () => {
    const fetchMock = vi.fn()
    const edit = client(fetchMock).edit
    await expect(edit.episodeTrailer({ mediaUrl: "https://r2/a.mp4", mediaUrls: ["https://r2/b.mp4"] })).rejects.toThrow(new TypeError("pass mediaUrl or mediaUrls, not both"))
    await expect(edit.estimateEpisodeTrailer({ formats: ["9:16"] })).rejects.toThrow(new TypeError("pass mediaUrl or mediaUrls"))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("edit.episodeChapters / estimateEpisodeChapters", () => {
  it("episodeChapters posts the recording and only the settings given", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-c", executionId: "exec-c" }))
    const out = await client(fetchMock).edit.episodeChapters({ mediaUrl: "https://r2/ep.mp4", planTier: "economy" })
    expect(out).toMatchObject({ jobId: "job-c", executionId: "exec-c" })
    const [url, init] = fetchMock.mock.calls[0]! as [string, { method: string; body: string; headers: Record<string, string> }]
    expect(url).toBe("https://api.example.com/v1/episode-chapters")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ mediaUrls: ["https://r2/ep.mp4"], planTier: "economy" })
    expect(init.headers["Idempotency-Key"]).toBeUndefined()
  })

  it("episodeChapters sends instructions and a style guide, and an Idempotency-Key when asked", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-c", deduped: true }))
    const out = await client(fetchMock).edit.episodeChapters(
      { mediaUrl: "https://r2/ep.mp4", instructions: "5 to 8 chapters", styleGuide: "Short titles" },
      { idempotencyKey: "retry-c" },
    )
    expect(out.deduped).toBe(true)
    const init = fetchMock.mock.calls[0]![1] as { body: string; headers: Record<string, string> }
    expect(init.headers["Idempotency-Key"]).toBe("retry-c")
    expect(JSON.parse(init.body)).toEqual({ mediaUrls: ["https://r2/ep.mp4"], instructions: "5 to 8 chapters", styleGuide: "Short titles" })
  })

  it("estimateEpisodeChapters posts the same body to its estimate route", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { totalCredits: 152, stepsCredits: 142, feeCredits: 10, durationSec: 2700 } }))
    const out = await client(fetchMock).edit.estimateEpisodeChapters({ mediaUrl: "https://r2/ep.mp4" })
    expect(out.data.feeCredits).toBe(10)
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.com/v1/episode-chapters/estimate")
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({ mediaUrls: ["https://r2/ep.mp4"] })
  })

  it("continueUseCase continues a Chapters run on its own route, read from the job", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(mockOk({ data: { id: "job-c", job_type: "episode-chapters", input_data: { type: "episode-chapters", mode: "run" } } }))
      .mockReturnValueOnce(mockOk({ jobId: "job-c2" }))
    const out = await client(fetchMock).edit.continueUseCase({ jobId: "job-c", mode: "from-failed" })
    expect(out.jobId).toBe("job-c2")
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.example.com/v1/episode-chapters/continue")
  })

  it("continueUseCase with nodeType episode-chapters posts straight to its route", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-c2" }))
    await client(fetchMock).edit.continueUseCase({ jobId: "job-c", mode: "from-failed", nodeType: "episode-chapters" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.com/v1/episode-chapters/continue")
  })
})

describe("edit.episodeTrailer / estimateEpisodeTrailer", () => {
  it("episodeTrailer posts the recording and the formats", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-t", executionId: "exec-t" }))
    const out = await client(fetchMock).edit.episodeTrailer({ mediaUrl: "https://r2/ep.mp4", formats: ["9:16"] })
    expect(out).toMatchObject({ jobId: "job-t", executionId: "exec-t" })
    const [url, init] = fetchMock.mock.calls[0]! as [string, { method: string; body: string; headers: Record<string, string> }]
    expect(url).toBe("https://api.example.com/v1/episode-trailer")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ mediaUrls: ["https://r2/ep.mp4"], formats: ["9:16"] })
    expect(init.headers["Idempotency-Key"]).toBeUndefined()
  })

  it("episodeTrailer sends the intro card, the review, the plan settings and an Idempotency-Key when asked", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-t" }))
    await client(fetchMock).edit.episodeTrailer(
      {
        mediaUrl: "https://r2/ep.mp4",
        introCardUrl: "https://r2/card.mp4",
        formats: ["1:1", "16:9"],
        reviewBeforeRender: true,
        planTier: "premium",
        instructions: "Open on the laugh",
        styleGuide: "Brisk",
      },
      { idempotencyKey: "retry-t" },
    )
    const init = fetchMock.mock.calls[0]![1] as { body: string; headers: Record<string, string> }
    expect(init.headers["Idempotency-Key"]).toBe("retry-t")
    expect(JSON.parse(init.body)).toEqual({
      mediaUrls: ["https://r2/ep.mp4"],
      introCardUrl: "https://r2/card.mp4",
      formats: ["1:1", "16:9"],
      reviewBeforeRender: true,
      planTier: "premium",
      instructions: "Open on the laugh",
      styleGuide: "Brisk",
    })
  })

  it("an empty format list reaches the route, which refuses it", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(400, { error: { code: "validation_error", message: "Choose at least one format" } }))
    await expect(client(fetchMock).edit.episodeTrailer({ mediaUrl: "https://r2/ep.mp4", formats: [] })).rejects.toBeInstanceOf(NodaroError)
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({ mediaUrls: ["https://r2/ep.mp4"], formats: [] })
  })

  it("estimateEpisodeTrailer posts the same body to its estimate route", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { totalCredits: 400, stepsCredits: 389, feeCredits: 11, durationSec: 3600 } }))
    const out = await client(fetchMock).edit.estimateEpisodeTrailer({ mediaUrl: "https://r2/ep.mp4", introCardUrl: "https://r2/card.mp4" })
    expect(out.data.feeCredits).toBe(11)
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.com/v1/episode-trailer/estimate")
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({ mediaUrls: ["https://r2/ep.mp4"], introCardUrl: "https://r2/card.mp4" })
  })

  it("continueUseCase renders a Trailer's final on its own route, read from the job", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(mockOk({ data: { id: "job-t", job_type: "episode-trailer", input_data: { type: "episode-trailer", mode: "run" } } }))
      .mockReturnValueOnce(mockOk({ jobId: "job-t2" }))
    const out = await client(fetchMock).edit.continueUseCase({ jobId: "job-t", mode: "render-final" })
    expect(out.jobId).toBe("job-t2")
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.example.com/v1/episode-trailer/continue")
    expect(JSON.parse((fetchMock.mock.calls[1]![1] as { body: string }).body)).toEqual({ jobId: "job-t", mode: "render-final" })
  })
})

describe("edit.clipPack / estimateClipPack", () => {
  it("clipPack posts the recording, the count and framing: null (no framing)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-c", executionId: "exec-c" }))
    const out = await client(fetchMock).edit.clipPack({ mediaUrl: "https://r2/ep.mp4", count: 5, framing: null })
    expect(out).toMatchObject({ jobId: "job-c", executionId: "exec-c" })
    const [url, init] = fetchMock.mock.calls[0]! as [string, { method: string; body: string; headers: Record<string, string> }]
    expect(url).toBe("https://api.example.com/v1/clip-pack")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ mediaUrls: ["https://r2/ep.mp4"], count: 5, framing: null })
    expect(init.headers["Idempotency-Key"]).toBeUndefined()
  })

  it("clipPack sends only what the caller set: a framing with an aspect alone leaves the layout to the route", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-c" }))
    await client(fetchMock).edit.clipPack({ mediaUrl: "https://r2/ep.mp4", framing: { aspect: "4:5" } })
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({ mediaUrls: ["https://r2/ep.mp4"], framing: { aspect: "4:5" } })
  })

  it("clipPack sends every setting and an Idempotency-Key when asked", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-c" }))
    await client(fetchMock).edit.clipPack(
      {
        mediaUrl: "https://r2/ep.mp4",
        count: 12,
        targetDurationSec: 30,
        framing: { aspect: "1:1", layout: "side-by-side", switchType: "cut", emphasisStyle: "border" },
        captions: false,
        captionStyle: "word-highlight",
        reviewBeforeRender: true,
        planTier: "premium",
        instructions: "The funniest moments",
        styleGuide: "Brisk",
      },
      { idempotencyKey: "retry-c" },
    )
    const init = fetchMock.mock.calls[0]![1] as { body: string; headers: Record<string, string> }
    expect(init.headers["Idempotency-Key"]).toBe("retry-c")
    expect(JSON.parse(init.body)).toEqual({
      mediaUrls: ["https://r2/ep.mp4"],
      count: 12,
      targetDurationSec: 30,
      framing: { aspect: "1:1", layout: "side-by-side", switchType: "cut", emphasisStyle: "border" },
      captions: false,
      captionStyle: "word-highlight",
      reviewBeforeRender: true,
      planTier: "premium",
      instructions: "The funniest moments",
      styleGuide: "Brisk",
    })
  })

  it("estimateClipPack posts the same body to its estimate route", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { totalCredits: 900, stepsCredits: 889, feeCredits: 11, durationSec: 3600 } }))
    const out = await client(fetchMock).edit.estimateClipPack({ mediaUrl: "https://r2/ep.mp4", count: 3 })
    expect(out.data.feeCredits).toBe(11)
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.com/v1/clip-pack/estimate")
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({ mediaUrls: ["https://r2/ep.mp4"], count: 3 })
  })

  it("continueUseCase renders a Clip Pack's final on its own route, read from the job", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(mockOk({ data: { id: "job-c", job_type: "clip-pack", input_data: { type: "clip-pack", mode: "run" } } }))
      .mockReturnValueOnce(mockOk({ jobId: "job-c2" }))
    const out = await client(fetchMock).edit.continueUseCase({ jobId: "job-c", mode: "render-final", editedEdl: { v: 1 } })
    expect(out.jobId).toBe("job-c2")
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.example.com/v1/clip-pack/continue")
    expect(JSON.parse((fetchMock.mock.calls[1]![1] as { body: string }).body)).toEqual({ jobId: "job-c", mode: "render-final", editedEdl: { v: 1 } })
  })

  it("continueUseCase with nodeType clip-pack skips the job read", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-c2" }))
    await client(fetchMock).edit.continueUseCase({ jobId: "job-c", mode: "from-failed", nodeType: "clip-pack" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.com/v1/clip-pack/continue")
  })
})
