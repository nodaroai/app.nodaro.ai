/**
 * `tk.providers.textToSpeech` and `tk.http.priceUgcCalls` — the UGC toolkit
 * members (spec §5.4, ADDITIVE-OPTIONAL 2026-10-06). The pricer is reached by a
 * dynamic import behind `hasCredits()`, so a non-Cloud build never loads `ee/`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  credits: true,
  eeLoaded: 0,
  price: vi.fn(async () => [2370, 3]),
  tts: vi.fn(async () => Buffer.from("mp3")),
  upload: vi.fn(async () => "https://cdn.example/job-1.mp3"),
  probe: vi.fn(async () => 7.4),
}))
vi.mock("../../config.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../config.js")>()), hasCredits: () => h.credits }))
vi.mock("../../../ee/lib/ugc-quote.js", () => { h.eeLoaded++; return { priceUgcCalls: h.price } })
vi.mock("../../../providers/elevenlabs/direct-tts.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../providers/elevenlabs/direct-tts.js")>()), directElevenLabsTTS: h.tts }))
vi.mock("../../storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../storage.js")>()),
  uploadBufferToR2: h.upload,
  mediaObjectKey: (jobId: string, kind: string, ext: string) => `${kind}/${jobId}.${ext}`,
}))
vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../providers/video/ffmpeg-utils.js")>()), probeMediaDuration: h.probe }))

import { buildToolkit } from "../toolkit.js"

beforeEach(() => { vi.clearAllMocks(); h.credits = true; h.eeLoaded = 0 })

describe("toolkit UGC members (spec §5.4)", () => {
  it("priceUgcCalls off Cloud throws before any ee import", async () => {
    h.credits = false
    await expect(buildToolkit().http.priceUgcCalls!({ userId: "u1" }, [{ tool: "image_to_text", args: {} }])).rejects.toThrow("UGC pricing needs Nodaro Cloud")
    expect(h.eeLoaded).toBe(0)
    expect(h.price).not.toHaveBeenCalled()
  })
  it("priceUgcCalls on Cloud delegates to the ee pricer and returns its numbers", async () => {
    const calls = [{ tool: "generate_video", args: { duration: 15 } }, { tool: "image_to_text", args: {} }]
    expect(await buildToolkit().http.priceUgcCalls!({ userId: "u1" }, calls)).toEqual([2370, 3])
    expect(h.price).toHaveBeenCalledWith({ userId: "u1" }, calls)
  })
  it("textToSpeech voices with the given voice and language, stores under the job's key, and measures the file", async () => {
    const out = await buildToolkit().providers.textToSpeech!("Hello", { model: "elevenlabs-v3", voiceId: "voice-1", languageCode: "he", jobId: "job-1", userId: "u1" })
    expect(h.tts).toHaveBeenCalledWith("Hello", "voice-1", "elevenlabs-v3", { languageCode: "he" })
    expect((h.tts.mock.calls[0] as unknown[])[3]).not.toHaveProperty("allowDefaultVoiceFallback")
    expect(h.upload).toHaveBeenCalledWith(Buffer.from("mp3"), "audio/job-1.mp3", "audio/mpeg", "u1")
    expect(h.probe).toHaveBeenCalledWith("https://cdn.example/job-1.mp3")
    expect(out).toEqual({ audioUrl: "https://cdn.example/job-1.mp3", durationSec: 7.4 })
  })
  it("textToSpeech without a language sends no language code", async () => {
    await buildToolkit().providers.textToSpeech!("Hello", { model: "elevenlabs-v3", voiceId: "voice-1", jobId: "job-1", userId: "u1" })
    expect(h.tts).toHaveBeenCalledWith("Hello", "voice-1", "elevenlabs-v3", {})
  })
  it("a missing voice fails the step; no other voice is tried", async () => {
    h.tts.mockRejectedValueOnce(Object.assign(new Error("voice_not_found"), { code: "voice_not_found" }))
    await expect(buildToolkit().providers.textToSpeech!("Hello", { model: "elevenlabs-v3", voiceId: "gone", jobId: "job-1", userId: "u1" })).rejects.toThrow("voice_not_found")
    expect(h.tts).toHaveBeenCalledTimes(1)
    expect(h.upload).not.toHaveBeenCalled()
  })
})
