/**
 * ElevenLabs direct-API provider tests.
 *
 * Five untested files in the ElevenLabs direct-API surface (everything
 * except direct-tts.ts, which has its own test file):
 *   - client.ts          — auth + headers + audio fetcher
 *   - voice-changer.ts   — speech-to-speech (directVoiceChanger,
 *                          voiceChangerFromUrl)
 *   - voice-design.ts    — text-to-voice/design
 *   - voice-remix.ts     — text-to-voice/create-previews
 *   - forced-alignment.ts — word-level alignment with character→word
 *                          fallback grouping
 *   - dubbing.ts         — full dubbing lifecycle (start/poll/download/
 *                          waitForDubbing)
 *
 * Each module wraps a different ElevenLabs endpoint with its own multipart
 * vs JSON body shape and its own success/error response handling. These
 * tests verify the request shape (URL, headers, body) and response
 * normalization for every public function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: { ELEVENLABS_API_KEY: "test-eleven-key", EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import {
  ELEVENLABS_BASE_URL,
  getElevenLabsApiKey,
  getElevenLabsHeaders,
  fetchAudioFromUrl,
} from "../client.js"
import { directVoiceChanger, voiceChangerFromUrl } from "../voice-changer.js"
import { designVoice } from "../voice-design.js"
import { remixVoice } from "../voice-remix.js"
import { forcedAlignment } from "../forced-alignment.js"
import {
  startDubbing,
  pollDubbingStatus,
  downloadDubbedAudio,
  waitForDubbing,
} from "../dubbing.js"

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function audioResponse(buf: Buffer | string, status = 200): Response {
  // Response constructor accepts Uint8Array but not Node Buffer typing —
  // cast via Uint8Array.from to satisfy DOM lib types in the test runtime.
  const bytes =
    typeof buf === "string"
      ? new TextEncoder().encode(buf)
      : Uint8Array.from(buf)
  return new Response(bytes, {
    status,
    headers: { "Content-Type": "audio/mpeg" },
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function errorResponse(text: string, status: number): Response {
  return new Response(text, { status })
}

// Convert a base64 string into the shape ElevenLabs returns from
// preview-style endpoints.
function previewsResponse(audio: Buffer, voiceId = "voice-1"): Response {
  return jsonResponse({
    previews: [{
      audio_base_64: audio.toString("base64"),
      generated_voice_id: voiceId,
      media_type: "audio/mpeg",
      duration_secs: 1.5,
    }],
  })
}

// ===========================================================================
// 1) client.ts
// ===========================================================================

describe("client — getElevenLabsApiKey", () => {
  it("returns the configured API key", () => {
    expect(getElevenLabsApiKey()).toBe("test-eleven-key")
  })

  it("throws when ELEVENLABS_API_KEY is not configured", async () => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({
      config: { ELEVENLABS_API_KEY: undefined, EDITION: "cloud" },
      hasCredits: () => true,
      isCloud: () => true,
      isCommunity: () => false,
      isBusiness: () => false,
      hasAdmin: () => true,
    }))
    const mod = await import("../client.js")
    expect(() => mod.getElevenLabsApiKey()).toThrow(
      /ELEVENLABS_API_KEY is not configured/,
    )
    vi.doUnmock("@/lib/config.js")
  })
})

describe("client — getElevenLabsHeaders", () => {
  it("returns the xi-api-key header", () => {
    expect(getElevenLabsHeaders()).toEqual({ "xi-api-key": "test-eleven-key" })
  })
})

describe("client — fetchAudioFromUrl", () => {
  it("returns a Buffer on 200", async () => {
    fetchMock.mockResolvedValueOnce(audioResponse(Buffer.from("audio-bytes")))

    const buf = await fetchAudioFromUrl("https://example.com/audio.mp3")

    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.toString()).toBe("audio-bytes")
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/audio.mp3")
  })

  it("throws on non-200", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse("not found", 404))

    await expect(fetchAudioFromUrl("https://example.com/missing.mp3"))
      .rejects.toThrow(/Failed to fetch audio from URL \(404\)/)
  })
})

// ===========================================================================
// 2) voice-changer.ts
// ===========================================================================

describe("voice-changer — directVoiceChanger", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(audioResponse(Buffer.from("converted-audio")))
  })

  it("returns the converted audio buffer", async () => {
    const result = await directVoiceChanger(Buffer.from("input"), "voice-id-1")
    expect(result.toString()).toBe("converted-audio")
  })

  it("POSTs to /v1/speech-to-speech/{voiceId}", async () => {
    await directVoiceChanger(Buffer.from("input"), "voice-id-1")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${ELEVENLABS_BASE_URL}/v1/speech-to-speech/voice-id-1`)
    expect((init as { method: string }).method).toBe("POST")
  })

  it("includes auth + Accept: audio/mpeg headers", async () => {
    await directVoiceChanger(Buffer.from("input"), "voice-id-1")
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(init.headers["xi-api-key"]).toBe("test-eleven-key")
    expect(init.headers["Accept"]).toBe("audio/mpeg")
  })

  it("uses default model_id = eleven_english_sts_v2", async () => {
    await directVoiceChanger(Buffer.from("input"), "voice-id-1")
    const init = fetchMock.mock.calls[0][1] as { body: FormData }
    expect(init.body.get("model_id")).toBe("eleven_english_sts_v2")
  })

  it("respects custom modelId", async () => {
    await directVoiceChanger(Buffer.from("input"), "v1", { modelId: "eleven_multilingual_sts_v2" })
    const init = fetchMock.mock.calls[0][1] as { body: FormData }
    expect(init.body.get("model_id")).toBe("eleven_multilingual_sts_v2")
  })

  it("appends remove_background_noise=true when set", async () => {
    await directVoiceChanger(Buffer.from("input"), "v1", { removeBackgroundNoise: true })
    const init = fetchMock.mock.calls[0][1] as { body: FormData }
    expect(init.body.get("remove_background_noise")).toBe("true")
  })

  it("omits remove_background_noise when false (per impl: only set when truthy)", async () => {
    await directVoiceChanger(Buffer.from("input"), "v1", { removeBackgroundNoise: false })
    const init = fetchMock.mock.calls[0][1] as { body: FormData }
    expect(init.body.get("remove_background_noise")).toBeNull()
  })

  it("packs stability + similarityBoost into voice_settings JSON", async () => {
    await directVoiceChanger(Buffer.from("input"), "v1", {
      stability: 0.3,
      similarityBoost: 0.9,
    })
    const init = fetchMock.mock.calls[0][1] as { body: FormData }
    const settings = JSON.parse(init.body.get("voice_settings") as string)
    expect(settings).toEqual({ stability: 0.3, similarity_boost: 0.9 })
  })

  it("defaults stability to 0.5 when only similarityBoost provided", async () => {
    await directVoiceChanger(Buffer.from("input"), "v1", { similarityBoost: 0.9 })
    const init = fetchMock.mock.calls[0][1] as { body: FormData }
    const settings = JSON.parse(init.body.get("voice_settings") as string)
    expect(settings).toEqual({ stability: 0.5, similarity_boost: 0.9 })
  })

  it("defaults similarity_boost to 0.75 when only stability provided", async () => {
    await directVoiceChanger(Buffer.from("input"), "v1", { stability: 0.3 })
    const init = fetchMock.mock.calls[0][1] as { body: FormData }
    const settings = JSON.parse(init.body.get("voice_settings") as string)
    expect(settings).toEqual({ stability: 0.3, similarity_boost: 0.75 })
  })

  it("omits voice_settings entirely when neither stability nor similarityBoost set", async () => {
    await directVoiceChanger(Buffer.from("input"), "v1")
    const init = fetchMock.mock.calls[0][1] as { body: FormData }
    expect(init.body.get("voice_settings")).toBeNull()
  })

  it("includes voice_settings when stability=0 (falsy but defined)", async () => {
    // 0 is a valid stability value; impl uses != null so 0 should work.
    await directVoiceChanger(Buffer.from("input"), "v1", { stability: 0 })
    const init = fetchMock.mock.calls[0][1] as { body: FormData }
    const settings = JSON.parse(init.body.get("voice_settings") as string)
    expect(settings.stability).toBe(0)
  })

  it("throws on non-200 with error text in message", async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(errorResponse("voice not found", 404))

    await expect(directVoiceChanger(Buffer.from("input"), "bad-voice"))
      .rejects.toThrow(/Voice Changer failed \(404\): voice not found/)
  })
})

describe("voice-changer — voiceChangerFromUrl", () => {
  it("fetches the audio URL then delegates to directVoiceChanger", async () => {
    fetchMock
      .mockResolvedValueOnce(audioResponse(Buffer.from("source-audio"))) // fetch step
      .mockResolvedValueOnce(audioResponse(Buffer.from("converted")))    // change step

    const result = await voiceChangerFromUrl("https://src.mp3", "voice-1")

    expect(result.toString()).toBe("converted")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe("https://src.mp3")
    expect(fetchMock.mock.calls[1][0]).toBe(
      `${ELEVENLABS_BASE_URL}/v1/speech-to-speech/voice-1`,
    )
  })

  it("propagates fetchAudioFromUrl errors", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse("server error", 500))

    await expect(voiceChangerFromUrl("https://src.mp3", "v1"))
      .rejects.toThrow(/Failed to fetch audio from URL \(500\)/)
    // Second call (the actual change) should never happen.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// 3) voice-design.ts
// ===========================================================================

describe("voice-design — designVoice", () => {
  it("POSTs to /v1/text-to-voice/design with required fields", async () => {
    fetchMock.mockResolvedValueOnce(previewsResponse(Buffer.from("audio")))

    await designVoice("hello", "deep narrator")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${ELEVENLABS_BASE_URL}/v1/text-to-voice/design`)
    expect((init as { method: string }).method).toBe("POST")
    const body = JSON.parse((init as { body: string }).body)
    expect(body).toEqual({ voice_description: "deep narrator", text: "hello" })
  })

  it("includes auth + Content-Type: application/json", async () => {
    fetchMock.mockResolvedValueOnce(previewsResponse(Buffer.from("a")))

    await designVoice("t", "d")

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(init.headers["xi-api-key"]).toBe("test-eleven-key")
    expect(init.headers["Content-Type"]).toBe("application/json")
  })

  it("forwards model → model_id, guidanceScale → guidance_scale, shouldEnhance → should_enhance", async () => {
    fetchMock.mockResolvedValueOnce(previewsResponse(Buffer.from("a")))

    await designVoice("t", "d", {
      model: "eleven_ttv_v3",
      loudness: 0.2,
      guidanceScale: 1.5,
      seed: 42,
      quality: 80,
      shouldEnhance: true,
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body).toEqual({
      voice_description: "d",
      text: "t",
      model_id: "eleven_ttv_v3",
      loudness: 0.2,
      guidance_scale: 1.5,
      seed: 42,
      quality: 80,
      should_enhance: true,
    })
  })

  it("preserves shouldEnhance=false (impl uses != null)", async () => {
    fetchMock.mockResolvedValueOnce(previewsResponse(Buffer.from("a")))

    await designVoice("t", "d", { shouldEnhance: false })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.should_enhance).toBe(false)
  })

  it("preserves seed=0 (falsy but defined)", async () => {
    fetchMock.mockResolvedValueOnce(previewsResponse(Buffer.from("a")))

    await designVoice("t", "d", { seed: 0 })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.seed).toBe(0)
  })

  it("returns audioBuffer (decoded base64) + generatedVoiceId", async () => {
    const audio = Buffer.from("fake-audio-bytes")
    fetchMock.mockResolvedValueOnce(previewsResponse(audio, "vid-abc"))

    const result = await designVoice("t", "d")

    expect(result.audioBuffer.toString()).toBe("fake-audio-bytes")
    expect(result.generatedVoiceId).toBe("vid-abc")
  })

  it("throws when previews array is empty", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ previews: [] }))

    await expect(designVoice("t", "d")).rejects.toThrow(
      /Voice Design returned no previews/,
    )
  })

  it("throws when previews is missing entirely", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))

    await expect(designVoice("t", "d")).rejects.toThrow(
      /Voice Design returned no previews/,
    )
  })

  it("throws on non-200 with error text", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse("invalid description", 400))

    await expect(designVoice("t", "d")).rejects.toThrow(
      /Voice Design failed \(400\): invalid description/,
    )
  })
})

// ===========================================================================
// 4) voice-remix.ts
// ===========================================================================

describe("voice-remix — remixVoice", () => {
  it("POSTs to /v1/text-to-voice/create-previews with required fields", async () => {
    fetchMock.mockResolvedValueOnce(previewsResponse(Buffer.from("a")))

    await remixVoice("hello", "raspy character")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${ELEVENLABS_BASE_URL}/v1/text-to-voice/create-previews`)
    expect((init as { method: string }).method).toBe("POST")
    const body = JSON.parse((init as { body: string }).body)
    expect(body).toEqual({ voice_description: "raspy character", text: "hello" })
  })

  it("forwards outputFormat → output_format", async () => {
    fetchMock.mockResolvedValueOnce(previewsResponse(Buffer.from("a")))

    await remixVoice("t", "d", { outputFormat: "mp3_44100_128" })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.output_format).toBe("mp3_44100_128")
  })

  it("omits output_format when not set", async () => {
    fetchMock.mockResolvedValueOnce(previewsResponse(Buffer.from("a")))

    await remixVoice("t", "d")

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.output_format).toBeUndefined()
  })

  it("returns the decoded base64 audio buffer (first preview only)", async () => {
    const audio = Buffer.from("remix-audio-bytes")
    fetchMock.mockResolvedValueOnce(previewsResponse(audio))

    const result = await remixVoice("t", "d")

    expect(result.toString()).toBe("remix-audio-bytes")
  })

  it("throws when previews array is empty", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ previews: [] }))

    await expect(remixVoice("t", "d")).rejects.toThrow(
      /Voice Remix returned no previews/,
    )
  })

  it("throws on non-200", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse("rate limited", 429))

    await expect(remixVoice("t", "d")).rejects.toThrow(
      /Voice Remix failed \(429\): rate limited/,
    )
  })
})

// ===========================================================================
// 5) forced-alignment.ts
// ===========================================================================

describe("forced-alignment — forcedAlignment", () => {
  it("fetches audio first, then POSTs to /v1/forced-alignment", async () => {
    fetchMock
      .mockResolvedValueOnce(audioResponse(Buffer.from("audio")))
      .mockResolvedValueOnce(jsonResponse({
        words: [{ word: "hello", start: 0, end: 0.5 }],
      }))

    await forcedAlignment("https://src.mp3", "hello")

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe("https://src.mp3")
    expect(fetchMock.mock.calls[1][0]).toBe(
      `${ELEVENLABS_BASE_URL}/v1/forced-alignment`,
    )
  })

  it("attaches transcript + audio in multipart form", async () => {
    fetchMock
      .mockResolvedValueOnce(audioResponse(Buffer.from("audio")))
      .mockResolvedValueOnce(jsonResponse({ words: [] }))

    await forcedAlignment("https://src.mp3", "hello world")

    const init = fetchMock.mock.calls[1][1] as { body: FormData }
    expect(init.body.get("transcript")).toBe("hello world")
    expect(init.body.get("audio")).toBeTruthy()
  })

  it("returns word-level alignment when API returns words", async () => {
    const expected = [
      { word: "hello", start: 0, end: 0.5 },
      { word: "world", start: 0.6, end: 1.0 },
    ]
    fetchMock
      .mockResolvedValueOnce(audioResponse(Buffer.from("audio")))
      .mockResolvedValueOnce(jsonResponse({ words: expected }))

    const result = await forcedAlignment("u", "hello world")

    expect(result.alignment).toEqual(expected)
  })

  it("groups characters into words on space boundary when API returns characters", async () => {
    fetchMock
      .mockResolvedValueOnce(audioResponse(Buffer.from("audio")))
      .mockResolvedValueOnce(jsonResponse({
        alignment: {
          characters: [
            { char: "h", start: 0.0, end: 0.1 },
            { char: "i", start: 0.1, end: 0.2 },
            { char: " ", start: 0.2, end: 0.25 },
            { char: "y", start: 0.3, end: 0.4 },
            { char: "o", start: 0.4, end: 0.5 },
          ],
        },
      }))

    const result = await forcedAlignment("u", "hi yo")

    expect(result.alignment).toHaveLength(2)
    expect(result.alignment[0]).toMatchObject({ word: "hi", start: 0.0 })
    expect(result.alignment[1]).toMatchObject({ word: "yo", start: 0.3 })
  })

  it("groups characters into words on newline boundary too", async () => {
    fetchMock
      .mockResolvedValueOnce(audioResponse(Buffer.from("audio")))
      .mockResolvedValueOnce(jsonResponse({
        alignment: {
          characters: [
            { char: "a", start: 0.0, end: 0.1 },
            { char: "\n", start: 0.1, end: 0.15 },
            { char: "b", start: 0.2, end: 0.3 },
          ],
        },
      }))

    const result = await forcedAlignment("u", "a\nb")

    expect(result.alignment.map((w) => w.word)).toEqual(["a", "b"])
  })

  it("returns empty alignment when neither words nor characters present", async () => {
    fetchMock
      .mockResolvedValueOnce(audioResponse(Buffer.from("audio")))
      .mockResolvedValueOnce(jsonResponse({}))

    const result = await forcedAlignment("u", "x")

    expect(result.alignment).toEqual([])
  })

  it("throws on non-200 from the alignment endpoint", async () => {
    fetchMock
      .mockResolvedValueOnce(audioResponse(Buffer.from("audio")))
      .mockResolvedValueOnce(errorResponse("transcript mismatch", 422))

    await expect(forcedAlignment("u", "x")).rejects.toThrow(
      /Forced Alignment failed \(422\): transcript mismatch/,
    )
  })
})

// ===========================================================================
// 6) dubbing.ts
// ===========================================================================

describe("dubbing — startDubbing", () => {
  it("POSTs to /v1/dubbing with file + target_lang", async () => {
    fetchMock
      .mockResolvedValueOnce(audioResponse(Buffer.from("audio")))
      .mockResolvedValueOnce(jsonResponse({
        dubbing_id: "dub-123",
        expected_duration_sec: 30,
      }))

    const result = await startDubbing("https://src.mp3", "es")

    expect(fetchMock.mock.calls[1][0]).toBe(`${ELEVENLABS_BASE_URL}/v1/dubbing`)
    const init = fetchMock.mock.calls[1][1] as { body: FormData }
    expect(init.body.get("target_lang")).toBe("es")
    expect(init.body.get("file")).toBeTruthy()
    expect(result.dubbingId).toBe("dub-123")
    expect(result.expectedDurationSec).toBe(30)
  })

  it("forwards optional source_lang, num_speakers, watermark (all stringified)", async () => {
    fetchMock
      .mockResolvedValueOnce(audioResponse(Buffer.from("audio")))
      .mockResolvedValueOnce(jsonResponse({ dubbing_id: "d", expected_duration_sec: 10 }))

    await startDubbing("u", "es", { sourceLang: "en", numSpeakers: 2, watermark: true })

    const init = fetchMock.mock.calls[1][1] as { body: FormData }
    expect(init.body.get("source_lang")).toBe("en")
    expect(init.body.get("num_speakers")).toBe("2")
    expect(init.body.get("watermark")).toBe("true")
  })

  it("preserves watermark=false (impl uses != null)", async () => {
    fetchMock
      .mockResolvedValueOnce(audioResponse(Buffer.from("audio")))
      .mockResolvedValueOnce(jsonResponse({ dubbing_id: "d", expected_duration_sec: 1 }))

    await startDubbing("u", "es", { watermark: false })

    const init = fetchMock.mock.calls[1][1] as { body: FormData }
    expect(init.body.get("watermark")).toBe("false")
  })

  it("preserves numSpeakers=0", async () => {
    fetchMock
      .mockResolvedValueOnce(audioResponse(Buffer.from("audio")))
      .mockResolvedValueOnce(jsonResponse({ dubbing_id: "d", expected_duration_sec: 1 }))

    await startDubbing("u", "es", { numSpeakers: 0 })

    const init = fetchMock.mock.calls[1][1] as { body: FormData }
    expect(init.body.get("num_speakers")).toBe("0")
  })

  it("throws on non-200", async () => {
    fetchMock
      .mockResolvedValueOnce(audioResponse(Buffer.from("audio")))
      .mockResolvedValueOnce(errorResponse("invalid lang", 400))

    await expect(startDubbing("u", "xx")).rejects.toThrow(
      /Dubbing start failed \(400\): invalid lang/,
    )
  })
})

describe("dubbing — startDubbing onTaskCreated reconciliation hook", () => {
  it("fires with the dubbing_id after the start POST returns", async () => {
    fetchMock
      .mockResolvedValueOnce(audioResponse(Buffer.from("audio")))
      .mockResolvedValueOnce(jsonResponse({
        dubbing_id: "el-dub-1",
        expected_duration_sec: 30,
      }))

    let captured: string | null = null
    const result = await startDubbing("https://x.test/a.mp3", "es", undefined, {
      onTaskCreated: async (id) => {
        captured = id
      },
    })

    expect(captured).toBe("el-dub-1")
    expect(result.dubbingId).toBe("el-dub-1")
  })

  it("swallows callback errors and still returns the start result", async () => {
    fetchMock
      .mockResolvedValueOnce(audioResponse(Buffer.from("audio")))
      .mockResolvedValueOnce(jsonResponse({
        dubbing_id: "el-dub-2",
        expected_duration_sec: 10,
      }))

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const result = await startDubbing("https://x.test/a.mp3", "es", undefined, {
      onTaskCreated: async () => {
        throw new Error("persistence failed")
      },
    })

    expect(result.dubbingId).toBe("el-dub-2")
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe("dubbing — pollDubbingStatus", () => {
  it("GETs /v1/dubbing/{id} and returns parsed JSON", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      dubbing_id: "dub-1",
      status: "dubbing",
      target_languages: ["es", "fr"],
    }))

    const status = await pollDubbingStatus("dub-1")

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${ELEVENLABS_BASE_URL}/v1/dubbing/dub-1`,
    )
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(status).toEqual({
      dubbing_id: "dub-1",
      status: "dubbing",
      target_languages: ["es", "fr"],
    })
  })

  it("throws on non-200", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse("not found", 404))

    await expect(pollDubbingStatus("missing")).rejects.toThrow(
      /Dubbing status check failed \(404\): not found/,
    )
  })
})

describe("dubbing — downloadDubbedAudio", () => {
  it("GETs /v1/dubbing/{id}/audio/{lang} and returns Buffer", async () => {
    fetchMock.mockResolvedValueOnce(audioResponse(Buffer.from("dubbed-bytes")))

    const buf = await downloadDubbedAudio("dub-1", "es")

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${ELEVENLABS_BASE_URL}/v1/dubbing/dub-1/audio/es`,
    )
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers["Accept"]).toBe("audio/mpeg")
    expect(buf.toString()).toBe("dubbed-bytes")
  })

  it("throws on non-200", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse("not ready", 409))

    await expect(downloadDubbedAudio("dub-1", "es")).rejects.toThrow(
      /Dubbing download failed \(409\): not ready/,
    )
  })
})

describe("dubbing — waitForDubbing", () => {
  // Fake timers let us advance past intervalMs deterministically without
  // pacing the test in real time.
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns immediately when status is 'dubbed' on first poll", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      dubbing_id: "d",
      status: "dubbed",
    }))

    const result = await waitForDubbing("d")

    expect(result.status).toBe("dubbed")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("polls until status is 'dubbed', invoking onProgress", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ dubbing_id: "d", status: "queued" }))
      .mockResolvedValueOnce(jsonResponse({ dubbing_id: "d", status: "dubbing" }))
      .mockResolvedValueOnce(jsonResponse({ dubbing_id: "d", status: "dubbed" }))

    const onProgress = vi.fn()
    const promise = waitForDubbing("d", onProgress, 60_000, 1000)

    // Advance through both intermediate polls.
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    const result = await promise

    expect(result.status).toBe("dubbed")
    expect(onProgress).toHaveBeenCalledWith("queued")
    expect(onProgress).toHaveBeenCalledWith("dubbing")
    expect(onProgress).toHaveBeenCalledWith("dubbed")
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("throws when status is 'failed', including server error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      dubbing_id: "d",
      status: "failed",
      error: "audio too short",
    }))

    await expect(waitForDubbing("d")).rejects.toThrow(
      /Dubbing failed: audio too short/,
    )
  })

  it("uses 'Unknown error' fallback when failed status has no error field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      dubbing_id: "d",
      status: "failed",
    }))

    await expect(waitForDubbing("d")).rejects.toThrow(
      /Dubbing failed: Unknown error/,
    )
  })

  it("throws on timeout when status never reaches dubbed", async () => {
    // Always pending — never reaches success or failed. Use mockImplementation
    // to return a *fresh* Response per call (Response bodies can only be
    // consumed once; mockResolvedValue would reuse the same object).
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ dubbing_id: "d", status: "queued" })),
    )

    const promise = waitForDubbing("d", undefined, 30_000, 5_000)
    // Catch the rejection ahead of advance so it doesn't unhandled-reject.
    const rejection = expect(promise).rejects.toThrow(/Dubbing timed out after 30s/)

    // Run timers until the deadline elapses.
    await vi.advanceTimersByTimeAsync(31_000)

    await rejection
  })
})
