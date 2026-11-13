import { describe, expect, it, vi, beforeEach } from "vitest"

const uploadBufferToR2 = vi.fn(async (_b: Buffer, key: string) => `https://r2.example/${key}`)
const finalizeJobWithMedia = vi.fn(async () => ({ ok: true }))
const wavToMp3 = vi.fn(async () => Buffer.from("ID3-mp3"))
const safeFetch = vi.fn(async () => new Response(Buffer.from("RIFF....WAVE")))
const single = vi.fn(async () => ({ data: { user_id: "u-1" } }))

vi.mock("../storage.js", () => ({
  uploadBufferToR2: (...a: Parameters<typeof uploadBufferToR2>) => uploadBufferToR2(...a),
  mediaObjectKey: (jobId: string, kind: string, ext: string) => `${kind}/${jobId}.${ext}`,
}))
vi.mock("../job-finalize.js", () => ({ finalizeJobWithMedia: (...a: unknown[]) => finalizeJobWithMedia(...(a as [])) }))
vi.mock("../safe-fetch.js", () => ({ safeFetch: (...a: unknown[]) => safeFetch(...(a as [])) }))
vi.mock("../supabase.js", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => single() }) }) }) },
}))
vi.mock("../../providers/audio/speech-mp3.js", () => ({
  isMp3SpeechFormat: (f: string) => f.startsWith("mp3_"),
  wavToMp3: (...a: unknown[]) => wavToMp3(...(a as [])),
}))

const { speechOutputFormatOf, geminiSpeechSentText, geminiDialogueSentLines, geminiSpeechCostUsd, geminiSpeechJobOf, deliverGeminiSpeech, recoverGeminiSpeechJob } =
  await import("../gemini-speech.js")

beforeEach(() => {
  uploadBufferToR2.mockClear()
  finalizeJobWithMedia.mockClear()
  wavToMp3.mockClear()
})

describe("the request's file and text", () => {
  it("an absent or unknown format is the default MP3; a known one is kept", () => {
    expect(speechOutputFormatOf(undefined)).toBe("mp3_44100_128")
    expect(speechOutputFormatOf("flac")).toBe("mp3_44100_128")
    expect(speechOutputFormatOf("wav_24000")).toBe("wav_24000")
    expect(speechOutputFormatOf("mp3_44100_192")).toBe("mp3_44100_192")
  })

  it("the text sent: clamped to the model's cap, its tags in the model's syntax", () => {
    expect(geminiSpeechSentText("gemini-3-8-flash-lite-tts", "Hi [laughs] there [excited] you")).toBe("Hi <laugh> there you")
    expect(geminiSpeechSentText("gemini-3-1-flash-tts", "Hi [whispers] there")).toBe("Hi [whispers] there")
    expect(geminiSpeechSentText("gemini-2-5-pro-tts", "a".repeat(12000))).toHaveLength(10000)
  })

  it("the cost is the task's own KIE credits, else the listed rate for the characters sent", () => {
    expect(geminiSpeechCostUsd("gemini-3-8-flash-tts", 1000, 0.61)).toBeCloseTo(0.00305)
    expect(geminiSpeechCostUsd("gemini-3-8-flash-tts", 2000, undefined)).toBeCloseTo(0.0213)
  })
})

describe("geminiSpeechJobOf — which stuck rows are Gemini speech", () => {
  it("reads the route's and the workflow engine's input_data", () => {
    expect(geminiSpeechJobOf({ id: "j", job_type: "text-to-speech", input_data: { resolvedModel: "gemini-3-8-flash-tts", text: "Hi", outputFormat: "wav_24000" } }))
      .toEqual({ jobType: "text-to-speech", provider: "gemini-3-8-flash-tts", billedCharacters: 2, outputFormat: "wav_24000" })
    expect(geminiSpeechJobOf({ id: "j", job_type: "text-to-speech", input_data: { provider: "gemini-2-5-pro-tts", text: "Hi" } }))
      .toEqual({ jobType: "text-to-speech", provider: "gemini-2-5-pro-tts", billedCharacters: 2, outputFormat: undefined })
  })

  it("a Gemini dialogue row: billed over all its lines as sent, completed as a dialogue, the default MP3", () => {
    const dialogue = [{ text: "Hi [laughs] you", voice: "Fola" }, { text: "Ok.", voice: "Puck" }]
    expect(geminiSpeechJobOf({ id: "j", job_type: "text-to-dialogue", input_data: { resolvedModel: "gemini-3-8-flash-lite-tts", dialogue } }))
      .toEqual({ jobType: "generate-dialogue", provider: "gemini-3-8-flash-lite-tts", billedCharacters: "Hi <laugh> you".length + 3, outputFormat: undefined })
    // An ElevenLabs dialogue row is not one (it is synchronous; nothing recovers it here).
    expect(geminiSpeechJobOf({ id: "j", job_type: "text-to-dialogue", input_data: { resolvedModel: "elevenlabs-dialogue", dialogue } })).toBeUndefined()
    expect(geminiSpeechJobOf({ id: "j", job_type: "text-to-dialogue", input_data: { dialogue } })).toBeUndefined()
  })

  it("geminiDialogueSentLines: each line by the one rule, the script cut once at the model's total cap", () => {
    expect(geminiDialogueSentLines("gemini-3-8-flash-tts", [{ text: "A [sighs]" }, { text: "B" }])).toEqual(["A <sighs>", "B"])
    const sent = geminiDialogueSentLines("gemini-3-1-flash-tts", [{ text: "a".repeat(9000) }, { text: "b".repeat(2000) }, { text: "c" }])
    expect(sent.map((t) => t.length)).toEqual([9000, 1000, 0])
  })

  it("is undefined for an ElevenLabs speech job and for any other job type", () => {
    expect(geminiSpeechJobOf({ id: "j", job_type: "text-to-speech", input_data: { provider: "elevenlabs-v4", text: "Hi" } })).toBeUndefined()
    expect(geminiSpeechJobOf({ id: "j", job_type: "generate-music", input_data: { provider: "gemini-3-8-flash-tts" } })).toBeUndefined()
    expect(geminiSpeechJobOf({ id: "j", job_type: "text-to-speech", input_data: null })).toBeUndefined()
  })
})

describe("deliverGeminiSpeech — one path for the worker and the reconcile", () => {
  it("an MP3 asked for (or none) is encoded from the WAV and stored as one, with what was sent and what it cost", async () => {
    await deliverGeminiSpeech({ jobId: "j1", userId: "u", provider: "gemini-3-8-flash-tts", wavUrl: "https://kie/a.wav", outputFormat: undefined, billedCharacters: 120, kieCredits: 0.5 })
    expect(wavToMp3).toHaveBeenCalledWith(expect.any(Buffer), "mp3_44100_128")
    expect(uploadBufferToR2).toHaveBeenCalledWith(Buffer.from("ID3-mp3"), "audio/j1.mp3", "audio/mpeg", "u")
    expect(finalizeJobWithMedia).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "j1",
      jobType: "text-to-speech",
      mediaUrl: "https://r2.example/audio/j1.mp3",
      result: expect.objectContaining({ url: "https://r2.example/audio/j1.mp3", providerUsed: "kie", cost: expect.closeTo(0.0025, 10) }),
      extraOutputData: { billedCharacters: 120, audioMimeType: "audio/mpeg" },
    }))
  })

  it("wav_24000 is the WAV as rendered", async () => {
    await deliverGeminiSpeech({ jobId: "j2", provider: "gemini-3-1-flash-tts", wavUrl: "https://kie/a.wav", outputFormat: "wav_24000", billedCharacters: 10 })
    expect(wavToMp3).not.toHaveBeenCalled()
    expect(uploadBufferToR2).toHaveBeenCalledWith(expect.any(Buffer), "audio/j2.wav", "audio/wav", undefined)
    expect(finalizeJobWithMedia).toHaveBeenCalledWith(expect.objectContaining({ extraOutputData: { billedCharacters: 10, audioMimeType: "audio/wav" } }))
  })

  it("a recovered task is delivered exactly as the worker would, from the row's own request", async () => {
    await recoverGeminiSpeechJob(
      { id: "j3", job_type: "text-to-speech", input_data: { resolvedModel: "gemini-3-8-flash-lite-tts", text: "Hi [laughs] you", outputFormat: "mp3_44100_192" } },
      { url: "https://kie/a.wav", kieCredits: 0.4 },
      "cron",
    )
    expect(wavToMp3).toHaveBeenCalledWith(expect.any(Buffer), "mp3_44100_192")
    expect(finalizeJobWithMedia).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "j3",
      claimant: "cron",
      extraOutputData: { billedCharacters: "Hi <laugh> you".length, audioMimeType: "audio/mpeg" },
      result: expect.objectContaining({ providerUsed: "kie", cost: expect.closeTo(0.002, 10) }),
    }))
    expect(uploadBufferToR2).toHaveBeenCalledWith(expect.any(Buffer), "audio/j3.mp3", "audio/mpeg", "u-1")
  })

  it("a recovered Gemini dialogue completes as a dialogue, as an MP3, billed over its lines", async () => {
    await recoverGeminiSpeechJob(
      { id: "j4", job_type: "text-to-dialogue", input_data: { resolvedModel: "gemini-3-1-flash-tts", dialogue: [{ text: "Hello", voice: "Kore" }, { text: "Hi", voice: "Puck" }] } },
      { url: "https://kie/a.wav", kieCredits: 0.78 },
      "cron",
    )
    expect(wavToMp3).toHaveBeenCalledWith(expect.any(Buffer), "mp3_44100_128")
    expect(finalizeJobWithMedia).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "j4",
      jobType: "generate-dialogue",
      extraOutputData: { billedCharacters: 7, audioMimeType: "audio/mpeg" },
    }))
  })
})

describe("a Gemini dialogue's file (decided 2026-11-13)", () => {
  it("a recovered dialogue that asked for the WAV is stored as the WAV, as the worker would", async () => {
    await recoverGeminiSpeechJob(
      { id: "j5", job_type: "text-to-dialogue", input_data: { resolvedModel: "gemini-3-8-flash-tts", dialogue: [{ text: "Hi", voice: "Fola" }], outputFormat: "wav_24000" } },
      { url: "https://kie/a.wav" },
      "cron",
    )
    expect(wavToMp3).not.toHaveBeenCalled()
    expect(uploadBufferToR2).toHaveBeenCalledWith(expect.any(Buffer), "audio/j5.wav", "audio/wav", "u-1")
    expect(finalizeJobWithMedia).toHaveBeenCalledWith(expect.objectContaining({ jobType: "generate-dialogue", extraOutputData: { billedCharacters: 2, audioMimeType: "audio/wav" } }))
  })
})
