import { describe, it, expect, vi, beforeEach } from "vitest"

const runKieTask = vi.fn()
vi.mock("../client.js", () => ({ runKieTask: (...a: unknown[]) => runKieTask(...a), createSanitizedError: (msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`), MAX_POLL_ATTEMPTS_VIDEO: 90 }))

vi.mock("../models.js", () => ({
  KIE_MUSIC_MODELS: {},
  KIE_TTS_MODELS: {},
  KIE_SOUND_EFFECT_MODELS: {},
  KIE_AUDIO_ISOLATION_MODELS: {},
  KIE_STT_MODELS: {
    "elevenlabs-stt": { model: "elevenlabs/speech-to-text", cost: 0.01 },
  },
  KIE_DIALOGUE_MODELS: {},
}))

import { KieAudioProvider } from "../audio.js"

describe("speechToText diarization passthrough", () => {
  beforeEach(() => runKieTask.mockReset())

  it("surfaces speaker-labelled words from the raw response", async () => {
    runKieTask.mockResolvedValue({
      resultJson: {
        text: "hi there",
        language_code: "en",
        words: [
          { text: "hi", type: "word", start: 0.0, end: 0.4, speaker_id: "speaker_0" },
          { text: " ", type: "spacing", start: 0.4, end: 0.45, speaker_id: "speaker_0" },
          { text: "there", type: "word", start: 0.5, end: 0.9, speaker_id: "speaker_1" },
        ],
      },
      cost: 1,
    })
    const provider = new KieAudioProvider()
    const res = await provider.speechToText("https://r2/audio.mp3", { diarize: true })
    expect(res.text).toBe("hi there")
    expect(res.words).toEqual([
      { text: "hi", start: 0.0, end: 0.4, speaker: "speaker_0" },
      { text: "there", start: 0.5, end: 0.9, speaker: "speaker_1" },
    ])
  })
})
