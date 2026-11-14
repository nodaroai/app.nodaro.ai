import { describe, it, expect, vi } from "vitest"
import { createClient, NodaroError, NotFoundError, StaticTokenAuth } from "../../index.js"
import type { DubbingAddLanguageInput, DubbingCreateInput, DubbingStructure } from "../../index.js"

function ok<T>(body: T, status = 200) {
  return Promise.resolve({ ok: true, status, json: async () => body } as unknown as Response)
}
function okText(text: string) {
  return Promise.resolve({ ok: true, status: 200, text: async () => text } as unknown as Response)
}
function refused(status: number, code: string, message: string) {
  return Promise.resolve({ ok: false, status, json: async () => ({ error: { code, message } }) } as unknown as Response)
}
function make(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock as unknown as typeof fetch })
}
function sent(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const init = fetchMock.mock.calls[call][1] as { method: string; body?: string }
  return { url: fetchMock.mock.calls[call][0] as string, method: init.method, body: init.body }
}

const JOB = "0b9f3c1e-6c0a-4f0e-9d53-4c1f0c7f2a11"
const ADDED_JOB = "5d2a7e90-13c4-4b8e-a1f6-9e0b6c3d4f22"

const STRUCTURE: DubbingStructure = {
  jobId: JOB,
  durationSec: 61.4,
  source: { language: "en", segments: [{ id: "s1", speakerId: "sp1", start: 0, end: 2.5, text: "Hello there." }] },
  languages: [
    {
      code: "es",
      jobId: JOB,
      status: "completed",
      segments: [{ id: "d1", speakerId: "sp1", start: 0, end: 2.5, sourceSegmentId: "s1", sourceText: "Hello there.", text: "Hola." }],
    },
    { code: "fr", jobId: ADDED_JOB, status: "processing", segments: [] },
  ],
  speakers: [{ id: "sp1", name: null, voice: null, segmentCount: 1 }],
  capabilities: { editSegments: false, regenerate: false, setSpeakerVoice: false, render: false, addLanguage: true, captions: true },
  addLanguage: { billableMinutes: 2, creditId: "elevenlabs-dubbing:2u", creditIdByLanguage: { he: "elevenlabs-dubbing-v2:2u" } },
}

const SRT = "1\n00:00:00,000 --> 00:00:02,500\nHola.\n"

describe("dubbing resource", () => {
  it("create() POSTs the whole input to /v1/dubbing and answers the job id", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(ok({ jobId: JOB }))
    const input: DubbingCreateInput = { videoUrl: "https://cdn.example.com/talk.mp4", targetLanguage: "es", numSpeakers: 2, dropBackgroundAudio: true }
    const out = await make(fetchMock).dubbing.create(input)
    const request = sent(fetchMock)
    expect(request.url).toBe("https://api.example.com/v1/dubbing")
    expect(request.method).toBe("POST")
    expect(JSON.parse(request.body as string)).toEqual(input)
    expect(out).toEqual({ jobId: JOB })
  })

  it("create() is the same request voices.dub() sends", async () => {
    const fetchMock = vi.fn().mockReturnValue(ok({ jobId: JOB }))
    const client = make(fetchMock)
    const input: DubbingCreateInput = { audioUrl: "https://cdn.example.com/talk.mp3", targetLanguage: "pt-BR", sourceLanguage: "en" }
    await client.dubbing.create(input)
    await client.voices.dub(input)
    expect(sent(fetchMock, 0)).toEqual(sent(fetchMock, 1))
  })

  it("get() GETs /v1/dubbing/:jobId and answers the structure as the server sent it", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(ok(STRUCTURE))
    const out = await make(fetchMock).dubbing.get(JOB)
    const request = sent(fetchMock)
    expect(request.url).toBe(`https://api.example.com/v1/dubbing/${JOB}`)
    expect(request.method).toBe("GET")
    expect(request.body).toBeUndefined()
    expect(out).toEqual(STRUCTURE)
  })

  it("get() keeps an id with a path character inside its own segment", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(ok(STRUCTURE))
    await make(fetchMock).dubbing.get("a/b?c")
    expect(sent(fetchMock).url).toBe("https://api.example.com/v1/dubbing/a%2Fb%3Fc")
  })

  it("captions() GETs the language in the format asked for and answers the file's text", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(okText("WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHola.\n"))
    const out = await make(fetchMock).dubbing.captions(JOB, { language: "es", format: "vtt" })
    const request = sent(fetchMock)
    expect(request.url).toBe(`https://api.example.com/v1/dubbing/${JOB}/captions?language=es&format=vtt`)
    expect(request.method).toBe("GET")
    expect(out).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHola.\n")
  })

  it("captions() leaves the format to the server when none is given", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(okText(SRT))
    const out = await make(fetchMock).dubbing.captions(JOB, { language: "source" })
    expect(sent(fetchMock).url).toBe(`https://api.example.com/v1/dubbing/${JOB}/captions?language=source`)
    expect(out).toBe(SRT)
  })

  it("captions() sends a regional code whole, and keeps the id inside its own segment", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(okText(SRT))
    await make(fetchMock).dubbing.captions("a/b", { language: "pt-BR", format: "srt" })
    expect(sent(fetchMock).url).toBe("https://api.example.com/v1/dubbing/a%2Fb/captions?language=pt-BR&format=srt")
  })

  it("addLanguage() POSTs the language to /v1/dubbing/:jobId/languages and answers the new job", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(ok({ jobId: ADDED_JOB }))
    const input: DubbingAddLanguageInput = { targetLanguage: "de", confirmationId: "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f" }
    const out = await make(fetchMock).dubbing.addLanguage(JOB, input)
    const request = sent(fetchMock)
    expect(request.url).toBe(`https://api.example.com/v1/dubbing/${JOB}/languages`)
    expect(request.method).toBe("POST")
    expect(JSON.parse(request.body as string)).toEqual(input)
    expect(out).toEqual({ jobId: ADDED_JOB })
  })

  it("addLanguage() keeps an id with a path character inside its own segment", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(ok({ jobId: ADDED_JOB }))
    await make(fetchMock).dubbing.addLanguage("a/b?c", { targetLanguage: "de" })
    expect(sent(fetchMock).url).toBe("https://api.example.com/v1/dubbing/a%2Fb%3Fc/languages")
  })

  it("a language the dub has is a NodaroError with its code", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(refused(409, "dubbing_language_exists", "This dub already has this language."))
    const error = await make(fetchMock).dubbing.addLanguage(JOB, { targetLanguage: "es" }).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(NodaroError)
    expect(error).toMatchObject({ code: "dubbing_language_exists", status: 409 })
  })

  it("a dub still being made is a NodaroError that carries the server's code and status", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(refused(409, "dubbing_not_ready", "The dub is still being made"))
    const error = await make(fetchMock).dubbing.get(JOB).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(NodaroError)
    expect(error).toMatchObject({ code: "dubbing_not_ready", status: 409, message: "The dub is still being made" })
  })

  it("a language the dub does not have is a NotFoundError that keeps its own code", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(refused(404, "dubbing_language_not_found", "The dub has no such language"))
    const error = await make(fetchMock).dubbing.captions(JOB, { language: "de" }).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(NotFoundError)
    expect(error).toMatchObject({ code: "dubbing_language_not_found", status: 404 })
  })
})
