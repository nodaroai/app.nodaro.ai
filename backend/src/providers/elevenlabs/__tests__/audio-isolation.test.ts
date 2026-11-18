/**
 * ElevenLabs audio isolation, called directly (decided 2026-11-18: the node
 * runs on ElevenLabs' own API). Pinned here: the multipart request the API
 * takes (`audio` file + `file_format`), the isolated audio stored in the type
 * the response names (never assumed), the failures mapped to sentences a user
 * can act on (the provider's own words kept for the operator), and a stalled
 * request that aborts.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const headers = vi.hoisted(() => ({ fn: vi.fn(() => ({ "xi-api-key": "test-key" }) as Record<string, string>) }))
vi.mock("../client.js", () => ({
  ELEVENLABS_BASE_URL: "https://api.elevenlabs.io",
  getElevenLabsHeaders: () => headers.fn(),
}))

import { directAudioIsolation, audioIsolationTimeoutMs, isolatedAudioFormat } from "../audio-isolation.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { providerDetailOf } from "../../../lib/provider-error-detail.js"

const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0, 0, 0, 0, 1, 2, 3])
const audioResponse = (body: Buffer, contentType: string | null, status = 200) =>
  new Response(new Uint8Array(body), { status, headers: contentType ? { "content-type": contentType } : {} })

let dir: string
let file: string

beforeEach(async () => {
  vi.restoreAllMocks()
  headers.fn.mockImplementation(() => ({ "xi-api-key": "test-key" }))
  dir = await mkdtemp(join(tmpdir(), "iso-test-"))
  file = join(dir, "voice.wav")
  await writeFile(file, Buffer.from("RIFF....WAVEfmt "))
})

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe("directAudioIsolation", () => {
  it("posts the file as multipart `audio` with `file_format: other` to /v1/audio-isolation, key header only", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(audioResponse(MP3, "audio/mpeg"))
    await directAudioIsolation(file, { audioSec: 8, sourceContentType: "audio/wav" })
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.elevenlabs.io/v1/audio-isolation")
    expect(init.method).toBe("POST")
    // xi-api-key only — no Content-Type, so fetch sets the multipart boundary.
    expect(init.headers).toEqual({ "xi-api-key": "test-key" })
    const form = init.body as FormData
    const part = form.get("audio") as File
    expect(part).toBeInstanceOf(Blob)
    expect(part.name).toBe("voice.wav")
    expect(part.type).toBe("audio/wav")
    expect(Buffer.from(await part.arrayBuffer()).toString("latin1")).toBe("RIFF....WAVEfmt ")
    expect(form.get("file_format")).toBe("other")
  })

  it("stores the isolated audio in the type the response names", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(audioResponse(MP3, "audio/mpeg"))
    const out = await directAudioIsolation(file, { audioSec: 8, sourceContentType: "audio/wav" })
    expect(out).toMatchObject({ contentType: "audio/mpeg", extension: "mp3" })
    expect(out.buffer.equals(MP3)).toBe(true)

    vi.spyOn(globalThis, "fetch").mockResolvedValue(audioResponse(Buffer.from("RIFFxxxxWAVEdata"), "audio/wav; charset=binary"))
    expect(await directAudioIsolation(file, { audioSec: 8, sourceContentType: "audio/wav" })).toMatchObject({ contentType: "audio/wav", extension: "wav" })
  })

  it("a response naming no type it knows is read by its first bytes; an unrecognisable one is a failure, never stored as a guess", () => {
    expect(isolatedAudioFormat("application/octet-stream", Buffer.from("fLaC\0\0\0"))).toEqual({ extension: "flac", contentType: "audio/flac" })
    expect(isolatedAudioFormat(null, Buffer.from("OggS\0\0"))).toEqual({ extension: "ogg", contentType: "audio/ogg" })
    expect(() => isolatedAudioFormat("text/html", Buffer.from("<html>"))).toThrow(/format/)
  })

  it("maps a refused request to a deterministic failure with a plain sentence; the provider's words go to the operator only", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"detail":{"status":"invalid_audio","message":"raw vendor words"}}', { status: 422 }))
    const err = await directAudioIsolation(file, { audioSec: 8, sourceContentType: "audio/wav" }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe("Audio Isolation could not process this audio. Check that it is a playable audio file, then try again.")
    expect((err as Error).message).not.toMatch(/vendor|422/)
    expect(providerDetailOf(err)).toMatch(/422/)
  })

  it("a busy or failing provider is retryable (not deterministic); a refused key is deterministic", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("slow down", { status: 429 }))
    const busy = await directAudioIsolation(file, { audioSec: 8, sourceContentType: "audio/wav" }).catch((e: unknown) => e)
    expect(isDeterministicJobError(busy)).toBe(false)
    expect((busy as Error).message).toMatch(/busy/)

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 503 }))
    const down = await directAudioIsolation(file, { audioSec: 8, sourceContentType: "audio/wav" }).catch((e: unknown) => e)
    expect(isDeterministicJobError(down)).toBe(false)

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("invalid api key", { status: 401 }))
    const key = await directAudioIsolation(file, { audioSec: 8, sourceContentType: "audio/wav" }).catch((e: unknown) => e)
    expect(isDeterministicJobError(key)).toBe(true)
    expect((key as Error).message).toMatch(/ElevenLabs key/)
  })

  it("a keyless install fails with the house refusal before anything is sent", async () => {
    const { MissingProviderKeyError } = await import("../../provider-keys.js")
    headers.fn.mockImplementation(() => { throw new MissingProviderKeyError("ELEVENLABS_API_KEY") })
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const err = await directAudioIsolation(file, { audioSec: 8, sourceContentType: "audio/wav" }).catch((e: unknown) => e)
    expect((err as { code?: string }).code).toBe("provider_key_missing")
    expect((err as Error).message).toMatch(/ELEVENLABS_API_KEY/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("a stalled request aborts at its timeout, sized from the audio's length", async () => {
    expect(audioIsolationTimeoutMs(8)).toBe(128_000)
    expect(audioIsolationTimeoutMs(1800)).toBe(1_920_000)
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      (init as RequestInit).signal!.addEventListener("abort", () => reject(new Error("aborted")))
    }))
    await expect(directAudioIsolation(file, { audioSec: 8, sourceContentType: "audio/wav", timeoutMs: 20 })).rejects.toThrow(/took too long/)
  })

  it("an empty 200 is a failure, never an empty result", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(audioResponse(Buffer.alloc(0), "audio/mpeg"))
    await expect(directAudioIsolation(file, { audioSec: 8, sourceContentType: "audio/wav" })).rejects.toThrow(/empty/)
  })
})
