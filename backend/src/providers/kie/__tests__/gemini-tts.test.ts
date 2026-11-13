import { describe, expect, it, vi, beforeEach } from "vitest"

const runKieTask = vi.fn()
vi.mock("../client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client.js")>()),
  runKieTask: (...args: unknown[]) => runKieTask(...args),
}))

const { geminiSpeechInput, runGeminiSpeech } = await import("../gemini-tts.js")

describe("geminiSpeechInput — KIE's request, each direction field where the model takes it", () => {
  it("3.8: the voice on the speaker, the free-text style on the line; no pace, accent or audio profile", () => {
    const input = geminiSpeechInput(
      "gemini-3-8-flash-lite-tts",
      [{ voice: "Fola", direction: { styleDirection: "slow and dry", pace: "Natural", accent: "Australian", audioProfile: "x" } }],
      [{ speaker: 0, text: "Hello <laugh> there.", style: "slow and dry" }],
    )
    expect(input).toEqual({
      speakers: [{ speaker_id: "Speaker 1", voice_name: "Fola" }],
      dialogue_turns: [{ speaker_id: "Speaker 1", text: "Hello <laugh> there.", style: "slow and dry" }],
    })
  })

  it("3.1 / 2.5: style, pace, accent and audio profile on the speaker; no style on the line", () => {
    for (const model of ["gemini-3-1-flash-tts", "gemini-2-5-pro-tts"]) {
      const input = geminiSpeechInput(
        model,
        [{ voice: "Kore", direction: { styleDirection: "Deadpan", pace: "Staccato", accent: "British (RP)", audioProfile: "A stern gatekeeper" } }],
        [{ speaker: 0, text: "[whispers] Halt.", style: "Deadpan" }],
      )
      expect(input).toEqual({
        speakers: [{ speaker_id: "Speaker 1", voice_name: "Kore", style: "Deadpan", pace: "Staccato", accent: "British (RP)", audio_profile: "A stern gatekeeper" }],
        dialogue_turns: [{ speaker_id: "Speaker 1", text: "[whispers] Halt." }],
      })
    }
  })

  it("a one-off clone (3.8 Flash) is sent as `replica` in place of `voice_name` — never both (decided 2026-11-13)", () => {
    const input = geminiSpeechInput(
      "gemini-3-8-flash-tts",
      [{ voice: "Fola", replica: { sourceAudioUrl: "https://r2.example/tmp/s.wav", consentAudioUrl: "https://r2.example/tmp/c.wav" } }, { voice: "Puck" }],
      [{ speaker: 0, text: "Hi." }, { speaker: 1, text: "Hey." }],
    )
    expect(input.speakers).toEqual([
      { speaker_id: "Speaker 1", replica: { source_audio_url: "https://r2.example/tmp/s.wav", consent_audio_url: "https://r2.example/tmp/c.wav" } },
      { speaker_id: "Speaker 2", voice_name: "Puck" },
    ])
  })

  it("sends no direction field the request did not set", () => {
    expect(geminiSpeechInput("gemini-3-1-flash-tts", [{ voice: "Kore" }], [{ speaker: 0, text: "Hi." }])).toEqual({
      speakers: [{ speaker_id: "Speaker 1", voice_name: "Kore" }],
      dialogue_turns: [{ speaker_id: "Speaker 1", text: "Hi." }],
    })
  })
})

describe("runGeminiSpeech", () => {
  beforeEach(() => runKieTask.mockReset())

  it("runs the model's KIE market task, keyed by our id, and reads the WAV and the credits the task consumed", async () => {
    runKieTask.mockResolvedValue({
      resultJson: { resultUrls: ["https://kie.example/a.wav"] },
      rawRecordInfo: { data: { creditsConsumed: 0.42 } },
      providerMs: 9000,
    })
    const onTaskCreated = vi.fn()
    const input = geminiSpeechInput("gemini-3-8-flash-tts", [{ voice: "Fola" }], [{ speaker: 0, text: "Hello." }])
    const result = await runGeminiSpeech("gemini-3-8-flash-tts", input, { onTaskCreated })
    expect(result).toEqual({ url: "https://kie.example/a.wav", kieCredits: 0.42, providerMs: 9000 })
    const [model, sent, , , opts] = runKieTask.mock.calls[0]!
    expect(model).toBe("google/gemini-3-8-flash-tts")
    expect(sent).toBe(input)
    expect(opts).toMatchObject({ onTaskCreated, modelKey: "gemini-3-8-flash-tts", dimensions: { characters: 6 } })
  })

  it("a record without credits leaves the cost to the listed rate", async () => {
    runKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://kie.example/a.wav"] }, rawRecordInfo: { data: {} } })
    const result = await runGeminiSpeech("gemini-2-5-pro-tts", geminiSpeechInput("gemini-2-5-pro-tts", [{ voice: "Kore" }], [{ speaker: 0, text: "Hi" }]))
    expect(result).toEqual({ url: "https://kie.example/a.wav" })
  })

  it("a task with no result URL fails", async () => {
    runKieTask.mockResolvedValue({ resultJson: { resultUrls: [] } })
    await expect(runGeminiSpeech("gemini-3-1-flash-tts", geminiSpeechInput("gemini-3-1-flash-tts", [{ voice: "Kore" }], [{ speaker: 0, text: "Hi" }]))).rejects.toThrow()
  })
})
