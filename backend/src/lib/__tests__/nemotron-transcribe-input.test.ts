import { beforeEach, describe, expect, it, vi } from "vitest"

const probe = vi.hoisted(() => ({
  fn: (async () => ({ durationSec: 61, sizeBytes: 1_000_000 })) as (url: string) => Promise<{ durationSec?: number; sizeBytes?: number }>,
  urls: [] as string[],
  /** The SSRF guard's verdict per URL: a throw blocks it (a private-resolving host, a parser-differential link, a DNS failure). */
  guard: (async () => {}) as (url: string) => Promise<void>,
}))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  assertSafeProbeSource: async (url: string) => probe.guard(url),
  probeMediaDurationAndSize: async (url: string) => {
    probe.urls.push(url)
    return probe.fn(url)
  },
}))

import { measureNemotronTranscribeInput, nemotronTranscribeReserveId, stampNemotronTranscribeInput } from "../nemotron-transcribe-input.js"

const NEMOTRON = "nemotron-3-5-transcribe"

beforeEach(() => {
  probe.fn = async () => ({ durationSec: 61, sizeBytes: 1_000_000 })
  probe.urls = []
  probe.guard = async () => {}
})

describe("measureNemotronTranscribeInput (the route's and the workflow run's one rule)", () => {
  it("measures the file and names the per-minute id its run reserves", async () => {
    expect(await measureNemotronTranscribeInput("https://x.example/a.mp3")).toEqual({
      ok: true,
      durationSec: 61,
      sizeBytes: 1_000_000,
      creditId: "nemotron-3-5-transcribe:2m",
    })
  })

  it("refuses what KIE would refuse, before anything is held", async () => {
    probe.fn = async () => ({ durationSec: 3600.5 })
    expect(await measureNemotronTranscribeInput("https://x.example/a.mp3")).toMatchObject({ ok: false, code: "media_duration_exceeds_limit" })
    probe.fn = async () => ({ durationSec: 3600, sizeBytes: 200 * 1024 * 1024 + 1 })
    expect(await measureNemotronTranscribeInput("https://x.example/a.mp3")).toMatchObject({ ok: false, code: "media_size_exceeds_limit" })
    // A size over the limit is refused even when the length cannot be read.
    probe.fn = async () => ({ sizeBytes: 300 * 1024 * 1024 })
    expect(await measureNemotronTranscribeInput("https://x.example/a.webm")).toMatchObject({ ok: false, code: "media_size_exceeds_limit" })
  })

  it("holds the 60-minute price for a file whose length cannot be read (it settles at KIE's length)", async () => {
    // A browser-recorded WebM written as a stream, a fragmented MP4: no duration declared.
    probe.fn = async () => ({ sizeBytes: 5_000_000 })
    expect(await measureNemotronTranscribeInput("https://x.example/rec.webm")).toEqual({
      ok: true,
      sizeBytes: 5_000_000,
      creditId: "nemotron-3-5-transcribe:60m",
    })
    // ffprobe cannot open it at all: the same hold, KIE decides.
    probe.fn = async () => {
      throw new Error("ffprobe: invalid data")
    }
    expect(await measureNemotronTranscribeInput("https://x.example/rec.webm")).toEqual({ ok: true, creditId: "nemotron-3-5-transcribe:60m" })
  })

  it("refuses a link the SSRF guard blocks — a public-looking host resolving to a private address — instead of holding 60 minutes", async () => {
    probe.guard = async (url) => {
      if (url.includes("sneaky.example")) throw new Error("probeVideoSource: blocked — sneaky.example resolves to private/reserved IP 10.0.0.7")
    }
    expect(await measureNemotronTranscribeInput("https://sneaky.example/a.mp3")).toMatchObject({ ok: false, code: "invalid_media_url" })
    expect(probe.urls).toEqual([])
    // A probe that fails on a link the guard passed still holds 60 minutes.
    probe.fn = async () => {
      throw new Error("ffprobe: invalid data")
    }
    expect(await measureNemotronTranscribeInput("https://fine.example/a.webm")).toEqual({ ok: true, creditId: "nemotron-3-5-transcribe:60m" })
  })

  it.each([
    ["a local path (ffprobe would read the server's own file)", "/etc/passwd"],
    ["a file: URL", "file:///etc/passwd"],
    ["plain http", "http://x.example/a.mp3"],
    ["a private host", "https://192.168.1.10/a.mp3"],
    ["localhost", "https://localhost/a.mp3"],
    ["not a URL at all", "nope"],
  ])("refuses %s before anything is probed", async (_what, url) => {
    expect(await measureNemotronTranscribeInput(url)).toMatchObject({ ok: false, code: "invalid_media_url" })
    expect(probe.urls).toEqual([])
  })

  it("accepts exactly 60 minutes and 200 MB, and a source that does not say its size", async () => {
    probe.fn = async () => ({ durationSec: 3600, sizeBytes: 200 * 1024 * 1024 })
    expect(await measureNemotronTranscribeInput("https://x.example/a.mp3")).toMatchObject({ ok: true, creditId: "nemotron-3-5-transcribe:60m" })
    probe.fn = async () => ({ durationSec: 30 })
    expect(await measureNemotronTranscribeInput("https://x.example/a.mp3")).toMatchObject({ ok: true, creditId: "nemotron-3-5-transcribe:1m" })
  })

  it("refuses a link to a video's page without probing it", async () => {
    expect(await measureNemotronTranscribeInput("https://www.tiktok.com/@a/video/1")).toMatchObject({ ok: false, code: "media_page_link_unsupported" })
    expect(probe.urls).toEqual([])
  })
})

describe("stampNemotronTranscribeInput (the workflow run's twin of the route's preHandler)", () => {
  it("stamps the length and the per-minute id the run reserves", async () => {
    const payload: Record<string, unknown> = { audioUrl: "https://cdn.example.com/a.mp3", provider: NEMOTRON }
    expect(await stampNemotronTranscribeInput("transcribe", payload)).toBeUndefined()
    expect(payload).toMatchObject({ duration_seconds: 61, bucketKey: "nemotron-3-5-transcribe:2m" })
    expect(nemotronTranscribeReserveId("transcribe", payload)).toBe("nemotron-3-5-transcribe:2m")
  })

  it("returns the route's refusal for a file it would refuse", async () => {
    probe.fn = async () => ({ durationSec: 4000 })
    const payload: Record<string, unknown> = { audioUrl: "https://x.example/a.mp3", provider: NEMOTRON }
    expect(await stampNemotronTranscribeInput("transcribe", payload)).toMatchObject({ code: "media_duration_exceeds_limit" })
    expect(payload).not.toHaveProperty("bucketKey")
  })

  it("refuses a user-written local path before anything is probed (the workflow's data.audioUrl)", async () => {
    const payload: Record<string, unknown> = { audioUrl: "/app/backend/.env", provider: NEMOTRON }
    expect(await stampNemotronTranscribeInput("transcribe", payload)).toMatchObject({ code: "invalid_media_url" })
    expect(probe.urls).toEqual([])
    expect(payload).not.toHaveProperty("bucketKey")
  })

  it("holds 60 minutes, with no measured length, when the length cannot be read", async () => {
    probe.fn = async () => ({})
    const payload: Record<string, unknown> = { audioUrl: "https://x.example/rec.webm", provider: NEMOTRON }
    expect(await stampNemotronTranscribeInput("transcribe", payload)).toBeUndefined()
    expect(payload.bucketKey).toBe("nemotron-3-5-transcribe:60m")
    expect(payload).not.toHaveProperty("duration_seconds")
  })

  it("leaves every other engine and every other job alone", async () => {
    const other: Record<string, unknown> = { audioUrl: "https://x.example/a.mp3", provider: "elevenlabs-stt" }
    expect(await stampNemotronTranscribeInput("transcribe", other)).toBeUndefined()
    expect(other).toEqual({ audioUrl: "https://x.example/a.mp3", provider: "elevenlabs-stt" })
    expect(nemotronTranscribeReserveId("transcribe", { ...other, bucketKey: "x" })).toBeUndefined()
    const job: Record<string, unknown> = { audioUrl: "https://x.example/a.mp3", provider: NEMOTRON }
    expect(await stampNemotronTranscribeInput("pitch-tempo", job)).toBeUndefined()
    expect(probe.urls).toEqual([])
  })
})
