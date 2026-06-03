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
})
