import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockRunKieTask = vi.fn()
  const mockCreateSanitizedError = vi.fn((msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`))
  return { mockRunKieTask, mockCreateSanitizedError }
})

vi.mock("../client.js", () => ({
  runKieTask: mocks.mockRunKieTask,
  createSanitizedError: mocks.mockCreateSanitizedError,
  MAX_POLL_ATTEMPTS_VIDEO: 90,
}))

vi.mock("../models.js", () => ({
  KIE_MUSIC_MODELS: {
    "suno": { model: "suno/v4", cost: 0.10 },
  },
  KIE_TTS_MODELS: {
    "elevenlabs-turbo": { model: "elevenlabs/text-to-speech-turbo-2-5", cost: 0.01 },
  },
  KIE_SOUND_EFFECT_MODELS: {
    "elevenlabs-sfx": { model: "elevenlabs/sound-effect-v2", cost: 0.01 },
  },
  KIE_AUDIO_ISOLATION_MODELS: {
    "elevenlabs-isolation": { model: "elevenlabs/audio-isolation", cost: 0.01 },
  },
}))

import { KieAudioProvider } from "../audio.js"

let provider: KieAudioProvider

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockRunKieTask.mockResolvedValue({
    resultJson: { resultUrls: ["https://kie.example.com/audio.mp3"] },
  })
  provider = new KieAudioProvider()
})

describe("KieAudioProvider.generateMusic", () => {
  it("happy path with default model", async () => {
    const result = await provider.generateMusic("epic orchestral")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith("suno/v4", { prompt: "epic orchestral" }, 90)
    expect(result.url).toBe("https://kie.example.com/audio.mp3")
    expect(result.cost).toBe(0.10)
  })

  it("passes duration and lyrics", async () => {
    await provider.generateMusic("rock", undefined, 30, "yeah!")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith("suno/v4", { prompt: "rock", duration: 30, lyrics: "yeah!" }, 90)
  })

  it("throws when no result URL", async () => {
    mocks.mockRunKieTask.mockResolvedValueOnce({ resultJson: {} })
    await expect(provider.generateMusic("test")).rejects.toThrow()
  })
})

describe("KieAudioProvider.textToSpeech", () => {
  it("happy path with default voice", async () => {
    const result = await provider.textToSpeech("Hello world")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      "elevenlabs/text-to-speech-turbo-2-5",
      expect.objectContaining({ text: "Hello world", voice: "Rachel" }),
    )
    expect(result.url).toBe("https://kie.example.com/audio.mp3")
  })

  it("passes custom voice and options", async () => {
    await provider.textToSpeech("Hi", "Daniel", undefined, {
      stability: 0.5, similarityBoost: 0.8, speed: 1.2,
    })
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      "elevenlabs/text-to-speech-turbo-2-5",
      expect.objectContaining({ voice: "Daniel", stability: 0.5, similarity_boost: 0.8, speed: 1.2 }),
    )
  })

  it("passes language_code", async () => {
    await provider.textToSpeech("Bonjour", undefined, undefined, { languageCode: "fr" })
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      "elevenlabs/text-to-speech-turbo-2-5",
      expect.objectContaining({ language_code: "fr" }),
    )
  })

  it("throws when no result URL", async () => {
    mocks.mockRunKieTask.mockResolvedValueOnce({ resultJson: {} })
    await expect(provider.textToSpeech("test")).rejects.toThrow()
  })
})

describe("KieAudioProvider.generateSoundEffect", () => {
  it("happy path", async () => {
    const result = await provider.generateSoundEffect("explosion")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith("elevenlabs/sound-effect-v2", { text: "explosion" }, 90)
    expect(result.url).toBe("https://kie.example.com/audio.mp3")
  })

  it("passes duration, loop, and promptInfluence options", async () => {
    await provider.generateSoundEffect("rain", { duration: 10, loop: true, promptInfluence: 0.5 })
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      "elevenlabs/sound-effect-v2",
      expect.objectContaining({ text: "rain", duration_seconds: 10, loop: true, prompt_influence: 0.5 }),
      90,
    )
  })
})

describe("KieAudioProvider.isolateAudio", () => {
  it("happy path", async () => {
    const result = await provider.isolateAudio("https://example.com/song.mp3")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith("elevenlabs/audio-isolation", { audio_url: "https://example.com/song.mp3" }, 90)
    expect(result.url).toBe("https://kie.example.com/audio.mp3")
  })

  it("throws when no result URL", async () => {
    mocks.mockRunKieTask.mockResolvedValueOnce({ resultJson: {} })
    await expect(provider.isolateAudio("https://example.com/song.mp3")).rejects.toThrow()
  })
})
