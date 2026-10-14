import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function make(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock as unknown as typeof fetch })
}

describe("audio resource", () => {
  it("separate() POSTs /v1/audio-separation with mode + quality", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j1" }))
    const c = make(fetchMock)
    await c.audio.separate({ audioUrl: "https://x/a.mp3", mode: "stems", quality: "best" })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/audio-separation")
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({ audioUrl: "https://x/a.mp3", mode: "stems", quality: "best" })
  })

  it("isolate() POSTs /v1/audio-isolation", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j2" }))
    const c = make(fetchMock)
    await c.audio.isolate({ audioUrl: "https://x/a.mp3" })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/audio-isolation")
  })

  it("applyFx() POSTs /v1/audio-fx", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j3" }))
    const c = make(fetchMock)
    await c.audio.applyFx({ audioUrl: "https://x/a.mp3", preset: "hall", mix: 40 })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/audio-fx")
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({ audioUrl: "https://x/a.mp3", preset: "hall", mix: 40 })
  })

  it("mix() POSTs /v1/mix-audio with audioUrls + trackVolumes", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j4" }))
    const c = make(fetchMock)
    await c.audio.mix({ audioUrls: ["https://x/a.mp3", "https://x/b.mp3"], trackVolumes: [100, 60] })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/mix-audio")
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({ audioUrls: ["https://x/a.mp3", "https://x/b.mp3"], trackVolumes: [100, 60] })
  })

  it("mix() sends endAt \"voice\" with a duck, and no endAt when absent", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j4b" })).mockReturnValueOnce(mockOk({ jobId: "j4c" }))
    const c = make(fetchMock)
    await c.audio.mix({ audioUrls: ["https://x/cut.mp4", "https://x/bed.mp3"], duck: { under: 0 }, endAt: "voice" })
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({
      audioUrls: ["https://x/cut.mp4", "https://x/bed.mp3"],
      duck: { under: 0 },
      endAt: "voice",
    })
    await c.audio.mix({ audioUrls: ["https://x/a.mp3", "https://x/b.mp3"], duck: { under: 0 } })
    expect(JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body)).not.toHaveProperty("endAt")
  })

  it("adjustVolume() POSTs /v1/adjust-volume", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j5" }))
    const c = make(fetchMock)
    await c.audio.adjustVolume({ audioUrl: "https://x/a.mp3", volume: 150, normalize: true })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/adjust-volume")
  })

  it("pitchTempo() POSTs /v1/pitch-tempo with the body as given", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j5b" }))
    const c = make(fetchMock)
    await c.audio.pitchTempo({ videoUrl: "https://x/v.mp4", semitones: -3, preserveFormants: false })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/pitch-tempo")
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({ videoUrl: "https://x/v.mp4", semitones: -3, preserveFormants: false })
  })

  it("combine() POSTs /v1/combine-audio with segments", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j6" }))
    const c = make(fetchMock)
    await c.audio.combine({ segments: [{ url: "https://x/a.mp3" }, { url: "https://x/b.mp3", startTime: 0, endTime: 5 }] })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/combine-audio")
  })

  it("transcribe() POSTs /v1/transcribe and passes the body through", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j7" }))
    const c = make(fetchMock)
    const res = await c.audio.transcribe({
      audioUrl: "https://x/a.mp3",
      provider: "elevenlabs-stt",
      language: "en",
      diarize: true,
      tagAudioEvents: true,
      wordTimestamps: true,
    })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/transcribe")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("POST")
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({
      audioUrl: "https://x/a.mp3",
      provider: "elevenlabs-stt",
      language: "en",
      diarize: true,
      tagAudioEvents: true,
      wordTimestamps: true,
    })
    expect(res).toEqual({ jobId: "j7" })
  })

  it("transcribe() sends only audioUrl when nothing else is given (no invented defaults)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j8" }))
    const c = make(fetchMock)
    await c.audio.transcribe({ audioUrl: "https://x/a.mp3" })
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({ audioUrl: "https://x/a.mp3" })
  })

  it("transcribe() accepts every engine the route does — the two whisper lanes as well as Scribe", async () => {
    // Doubles as a compile-time pin: `provider` is `TranscribeProvider`, so a
    // lane leaving that enum would fail tsc here rather than at a caller's 400.
    for (const provider of ["whisper", "incredibly-fast-whisper", "elevenlabs-stt"] as const) {
      const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j9" }))
      const c = make(fetchMock)
      await c.audio.transcribe({ audioUrl: "https://x/a.mp3", provider })
      expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({
        audioUrl: "https://x/a.mp3",
        provider,
      })
    }
  })
})
