import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function make(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({
    baseUrl: "https://api.example.com",
    auth: new StaticTokenAuth("t"),
    fetch: fetchMock as unknown as typeof fetch,
  })
}

describe("voices resource", () => {
  it("list() GETs /v1/voices and returns voices[]", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ voices: [{ voice_id: "v1", name: "Rachel" }] }),
    )
    const c = make(fetchMock)
    const out = await c.voices.list()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/voices")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(out).toEqual([{ voice_id: "v1", name: "Rachel" }])
  })

  it("searchLibrary() builds the querystring and returns { voices, hasMore }", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ voices: [], hasMore: true }))
    const c = make(fetchMock)
    const out = await c.voices.searchLibrary({ search: "deep", gender: "male", page: 2, page_size: 30 })
    const url = fetchMock.mock.calls[0][0] as string
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(url).toMatch(/^https:\/\/api\.example\.com\/v1\/voices\/library\?/)
    expect(url).toContain("search=deep")
    expect(url).toContain("gender=male")
    expect(url).toContain("page=2")
    expect(out.hasMore).toBe(true)
  })

  it("searchLibrary() omits undefined params", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ voices: [], hasMore: false }))
    const c = make(fetchMock)
    await c.voices.searchLibrary({ search: "x" })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toContain("gender=")
    expect(url).not.toContain("undefined")
  })

  it("listClones() GETs /v1/voice-clones and unwraps voiceClones[]", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({
        voiceClones: [
          { id: "vc1", name: "My Voice", elevenlabsVoiceId: "el1", sampleAudioUrl: "https://r2/a.mp3", createdAt: "2026-06-01T00:00:00Z" },
        ],
      }),
    )
    const c = make(fetchMock)
    const out = await c.voices.listClones()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/voice-clones")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(out).toEqual([
      { id: "vc1", name: "My Voice", elevenlabsVoiceId: "el1", sampleAudioUrl: "https://r2/a.mp3", createdAt: "2026-06-01T00:00:00Z" },
    ])
  })

  it("createClone() POSTs /v1/voice-clones/from-url with a JSON { name, audioUrl } body", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ id: "vc2", name: "Cloned", elevenlabsVoiceId: "el2", sampleAudioUrl: "https://r2/b.mp3", createdAt: "2026-06-02T00:00:00Z", jobId: "j1" }),
    )
    const c = make(fetchMock)
    const out = await c.voices.createClone({ name: "Cloned", audioUrl: "https://r2/b.mp3" })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/voice-clones/from-url")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ name: "Cloned", audioUrl: "https://r2/b.mp3" })
    expect(out.elevenlabsVoiceId).toBe("el2")
  })

  it("deleteClone() DELETEs /v1/voice-clones/:id", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(undefined))
    const c = make(fetchMock)
    await c.voices.deleteClone("vc1")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/voice-clones/vc1")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("DELETE")
  })

  it("recast() POSTs /v1/voice-changer-pro, forwarding output + analysis (the interactive fast-path)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-recast" }))
    const c = make(fetchMock)
    const analysis = {
      vocalsUrl: "https://r2/vocals.wav",
      speakers: [{ id: "spk_0", segments: [{ start: 0, end: 5 }] }],
      languageCode: "en",
    }
    const out = await c.voices.recast({ audioUrl: "https://r2/a.mp3", orderedVoices: ["Rachel"], output: "stems", analysis })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/voice-changer-pro")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ audioUrl: "https://r2/a.mp3", orderedVoices: ["Rachel"], output: "stems", analysis })
    expect(out.jobId).toBe("j-recast")
  })

  it("analyze() POSTs /v1/voice-changer-pro/analyze and returns { jobId }", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-analyze" }))
    const c = make(fetchMock)
    const out = await c.voices.analyze({ videoUrl: "https://r2/clip.mp4", separationQuality: "best", suggestTitle: true })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/voice-changer-pro/analyze")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ videoUrl: "https://r2/clip.mp4", separationQuality: "best", suggestTitle: true })
    expect(out.jobId).toBe("j-analyze")
  })

  it("exportMix() POSTs /v1/voice-changer-pro/export with the mixed tracks", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-export" }))
    const c = make(fetchMock)
    const input = {
      videoUrl: "https://r2/clip.mp4",
      tracks: [
        { url: "https://r2/spk0.wav", gain: 100, muted: false, kind: "voice" as const },
        { url: "https://r2/bg.wav", gain: 60, muted: false, kind: "background" as const },
      ],
      voiceFx: { preset: "hall" as const, wetDryMix: 30 },
    }
    const out = await c.voices.exportMix(input)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/voice-changer-pro/export")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual(input)
    expect(out.jobId).toBe("j-export")
  })

  it("change() forwards the new model / useSpeakerBoost / seed params", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-change" }))
    const c = make(fetchMock)
    await c.voices.change({ voiceId: "Rachel", audioUrl: "https://r2/a.mp3", model: "eleven_multilingual_sts_v2", useSpeakerBoost: false, seed: 42 })
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(JSON.parse(init.body)).toEqual({ voiceId: "Rachel", audioUrl: "https://r2/a.mp3", model: "eleven_multilingual_sts_v2", useSpeakerBoost: false, seed: 42 })
  })

  it("design() POSTs /v1/voice-design and returns { jobId }", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-design" }))
    const c = make(fetchMock)
    const out = await c.voices.design({ text: "x".repeat(120), voiceDescription: "a warm narrator", guidanceScale: 40 })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/voice-design")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("POST")
    expect(out.jobId).toBe("j-design")
  })

  it("remix() POSTs /v1/voice-remix", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-remix" }))
    const c = make(fetchMock)
    await c.voices.remix({ text: "hello", voiceDescription: "a raspy detective" })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/voice-remix")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("POST")
  })

  it("dub() POSTs /v1/dubbing with the target language", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-dub" }))
    const c = make(fetchMock)
    await c.voices.dub({ audioUrl: "https://r2/a.mp3", targetLanguage: "es", numSpeakers: 2 })
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/dubbing")
    expect(JSON.parse(init.body)).toEqual({ audioUrl: "https://r2/a.mp3", targetLanguage: "es", numSpeakers: 2 })
  })

  it("createCloneFromFile() POSTs multipart /v1/voice-clones (FormData with name + file)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockOk({ id: "vc3", name: "Mine", elevenlabsVoiceId: "el3", sampleAudioUrl: "https://r2/s.mp3", createdAt: "2026-07-16T00:00:00Z" }),
    )
    const c = make(fetchMock)
    const out = await c.voices.createCloneFromFile({ name: "Mine", file: new Uint8Array([1, 2, 3]), filename: "s.mp3", contentType: "audio/mpeg" })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/voice-clones")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: unknown }
    expect(init.method).toBe("POST")
    expect(init.body).toBeInstanceOf(FormData)
    const fd = init.body as FormData
    expect(fd.get("name")).toBe("Mine")
    expect(fd.get("file")).toBeInstanceOf(Blob)
    expect(out.elevenlabsVoiceId).toBe("el3")
  })
})
