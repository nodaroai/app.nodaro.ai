/**
 * The voice lock's backstop in the speech worker (workers/handlers/audio-ai.ts).
 *
 * Every lane that creates a speech job judges its voices first (the routes, the
 * workflow engine, the film-studio pipeline). The worker judges them again, as
 * the job's user, before it sends anything, so a lane that forgets still fails
 * closed. A refusal is final: the video worker fails and refunds the job on this
 * attempt (a deterministic job error) instead of retrying the same refusal.
 *
 * With no lock nothing is asked, and the job runs as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  directTTS: vi.fn(async () => Buffer.from("tts")),
  directTTSWithTimestamps: vi.fn(),
  directDialogue: vi.fn(async () => ({ audio: Buffer.from("dialogue") })),
  voiceChangerFromUrl: vi.fn(async () => Buffer.from("revoiced")),
  directVoiceChanger: vi.fn(async () => Buffer.from("revoiced")),
  extractAudioTrack: vi.fn(async () => ({ audioPath: "/tmp/vc/audio.mp3", workDir: "/tmp/vc" })),
  probeMediaStreams: vi.fn(async (url: string) => ({ hasVideo: /\.mp4$/.test(url), hasAudio: true })),
  startDubbing: vi.fn(),
  requireImportAllowed: vi.fn(async () => undefined),
  spendImportConfirmation: vi.fn(async () => null),
  cloudTextToSpeech: vi.fn(async () => ({ url: "https://cloud.example.com/a.mp3", cost: null })),
  isNodaroConnected: vi.fn(async () => false),
  finalize: vi.fn(async () => ({ ok: true })),
  judgeVoices: vi.fn(async (_voices: readonly string[], _lookup: { userId?: string | null }) => ({ allowed: true }) as { allowed: boolean; reason?: string }),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(() => ({ update: vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) })) })) } }))
vi.mock("@/lib/storage.js", () => ({
  uploadToR2: vi.fn(async () => "https://r2.example.com/a.mp3"),
  uploadBufferToR2: vi.fn(async () => "https://r2.example.com/a.mp3"),
  uploadFileToR2: vi.fn(async () => "https://r2.example.com/v.mp4"),
  mediaObjectKey: (id: string, type: string, ext: string) => `${type}s/${id}.${ext}`,
}))
vi.mock("@/providers/elevenlabs/direct-tts.js", () => ({
  directElevenLabsTTS: mocks.directTTS,
  directElevenLabsTTSWithTimestamps: mocks.directTTSWithTimestamps,
  stripAudioTags: (t: string) => t,
}))
vi.mock("@/providers/elevenlabs/direct-dialogue.js", () => ({ directElevenLabsDialogue: mocks.directDialogue }))
vi.mock("@/providers/elevenlabs/voice-changer.js", () => ({ voiceChangerFromUrl: mocks.voiceChangerFromUrl, directVoiceChanger: mocks.directVoiceChanger }))
vi.mock("@/providers/video/extract-audio-track.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/extract-audio-track.js")>()),
  extractAudioTrack: mocks.extractAudioTrack,
}))
vi.mock("@/providers/video/merge-video-audio.js", () => ({ mergeVideoAudio: vi.fn(async () => "/tmp/merged/out.mp4") }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: vi.fn(async () => undefined),
  probeMediaStreams: mocks.probeMediaStreams,
  createWorkDir: vi.fn(async () => "/tmp/wd"),
}))
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return { ...actual, promises: { ...actual.promises, readFile: vi.fn(async () => Buffer.from("source")), writeFile: vi.fn(async () => undefined) } }
})
vi.mock("@/providers/elevenlabs/dubbing.js", () => ({
  startDubbing: mocks.startDubbing,
  waitForDubbing: vi.fn(),
  pollDubbingStatus: vi.fn(),
  downloadDubbedMedia: vi.fn(),
  DUBBING_MAX_DURATION_SEC: 30 * 60,
}))
vi.mock("../../../lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalize }))
vi.mock("../../shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared.js")>()),
  commitJobCredits: vi.fn(async () => undefined),
  shouldSaveJobResult: vi.fn(async () => true),
  markJobCompleted: vi.fn(async () => true),
  setJobProgress: vi.fn(async () => undefined),
  withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
  generateAndUploadThumbnail: vi.fn(async () => "https://r2.example.com/t.png"),
  createAssetFromJob: vi.fn(async () => undefined),
}))
vi.mock("../../../lib/import-gate.js", () => ({
  isImportRefusal: () => false,
  requireImportAllowed: mocks.requireImportAllowed,
  spendImportConfirmation: mocks.spendImportConfirmation,
}))
vi.mock("../../../lib/nodaro-connect.js", () => ({ isNodaroConnected: mocks.isNodaroConnected }))
vi.mock("../../../providers/nodaro/audio.js", () => ({
  NodaroCloudAudioProvider: vi.fn().mockImplementation(function () { return { textToSpeech: mocks.cloudTextToSpeech } }),
}))
vi.mock("../../../lib/safe-fetch.js", () => ({
  safeFetch: vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array(Buffer.from("cloud")).buffer })),
}))
// The lock's resolver (lib/voice-gender.ts, tested in its own module).
vi.mock("@/lib/voice-gender.js", () => ({ judgeVoices: mocks.judgeVoices }))

import { audioAIHandlers } from "../audio-ai.js"
import { config } from "../../../lib/config.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { VoiceNotAvailableError } from "../../../lib/voice-policy.js"

const job = (name: string, data: Record<string, unknown>) => ({ name, data: { jobId: "job-1", ...data }, id: "bull-1", updateProgress: vi.fn() })
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false }

const prevEdition = config.EDITION
const prevKey = config.ELEVENLABS_API_KEY

function maleOnly(): void {
  config.EDITION = "business" // surfaceGateOpen() → true (read live)
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["male"] } })
  __resetSurfaceProfileCacheForTests()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.judgeVoices.mockResolvedValue({ allowed: true })
  config.ELEVENLABS_API_KEY = "test-key"
})
afterEach(() => {
  config.EDITION = prevEdition
  config.ELEVENLABS_API_KEY = prevKey
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

/** Every speech the provider was asked for, by any of the three funnels. */
function providerCalls(): number {
  return mocks.directTTS.mock.calls.length + mocks.directTTSWithTimestamps.mock.calls.length +
    mocks.directDialogue.mock.calls.length + mocks.voiceChangerFromUrl.mock.calls.length +
    mocks.directVoiceChanger.mock.calls.length + mocks.startDubbing.mock.calls.length +
    mocks.cloudTextToSpeech.mock.calls.length
}

const SPEECH_JOBS: Array<[string, Record<string, unknown>, string[]]> = [
  ["text-to-speech", { text: "Hello", provider: "elevenlabs-v3", voice: "LibVoice000000000001", voiceType: "premade" }, ["LibVoice000000000001"]],
  ["text-to-dialogue", { dialogue: [{ text: "Hi", voice: "George" }, { text: "Yo", voice: "LibVoice000000000001" }] }, ["George", "LibVoice000000000001"]],
  ["voice-changer", { audioUrl: "https://example.com/a.mp3", voiceId: "LibVoice000000000001" }, ["LibVoice000000000001"]],
  ["voice-changer", { videoUrl: "https://example.com/v.mp4", voiceId: "LibVoice000000000001" }, ["LibVoice000000000001"]],
]

describe("the speech worker judges every voice it sends, under a lock", () => {
  it.each(SPEECH_JOBS)("%s: a refused voice fails the job before the provider is asked, and the refusal is final", async (name, data) => {
    maleOnly()
    mocks.judgeVoices.mockResolvedValueOnce({ allowed: false, reason: "gender_unknown" })

    const err = await audioAIHandlers[name]!(job(name, data) as never, ctx).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(VoiceNotAvailableError)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(providerCalls()).toBe(0)
    expect(mocks.extractAudioTrack).not.toHaveBeenCalled()
    expect(mocks.probeMediaStreams).not.toHaveBeenCalled()
    expect(mocks.finalize).not.toHaveBeenCalled()
  })

  it.each(SPEECH_JOBS)("%s: asks about exactly the voices it sends, as the job's user, then sends them", async (name, data, voices) => {
    maleOnly()

    await audioAIHandlers[name]!(job(name, data) as never, ctx)

    expect(mocks.judgeVoices).toHaveBeenCalledWith(voices, { userId: "user-1" })
    expect(providerCalls()).toBe(1)
  })

  it("dubbing: refused under a lock before the media is probed, the import gate read or the service asked", async () => {
    maleOnly()

    const err = await audioAIHandlers.dubbing!(job("dubbing", { sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", targetLanguage: "fr" }) as never, ctx)
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(VoiceNotAvailableError)
    expect(err).toMatchObject({ message: "Dubbing is not available on this deployment." })
    expect(isDeterministicJobError(err)).toBe(true)
    expect(mocks.requireImportAllowed).not.toHaveBeenCalled()
    expect(mocks.spendImportConfirmation).not.toHaveBeenCalled()
    expect(mocks.probeMediaStreams).not.toHaveBeenCalled()
    expect(mocks.startDubbing).not.toHaveBeenCalled()
  })

  it("text-to-speech with no voice speaks in the policy's default voice, on the cloud relay too", async () => {
    maleOnly()
    config.ELEVENLABS_API_KEY = ""
    mocks.isNodaroConnected.mockResolvedValueOnce(true)

    await audioAIHandlers["text-to-speech"]!(job("text-to-speech", { text: "Hello", provider: "elevenlabs-v3" }) as never, ctx)

    // The cloud's own default voice knows nothing of this deployment's lock.
    expect(mocks.cloudTextToSpeech).toHaveBeenCalledWith("Hello", "Adam", "elevenlabs-v3", expect.anything())
    expect(mocks.judgeVoices).not.toHaveBeenCalled()
  })
})

describe("with no lock, the speech worker asks nothing", () => {
  it.each(SPEECH_JOBS)("%s runs as before", async (name, data) => {
    await audioAIHandlers[name]!(job(name, data) as never, ctx)

    expect(mocks.judgeVoices).not.toHaveBeenCalled()
    expect(providerCalls()).toBe(1)
  })

  it("text-to-speech with no voice leaves the cloud relay to pick its default (unchanged)", async () => {
    config.ELEVENLABS_API_KEY = ""
    mocks.isNodaroConnected.mockResolvedValueOnce(true)

    await audioAIHandlers["text-to-speech"]!(job("text-to-speech", { text: "Hello", provider: "elevenlabs-v3" }) as never, ctx)

    expect(mocks.cloudTextToSpeech).toHaveBeenCalledWith("Hello", undefined, "elevenlabs-v3", expect.anything())
  })

  it("dubbing is not refused", async () => {
    mocks.startDubbing.mockRejectedValueOnce(new Error("stop here: the service was asked"))

    const err = await audioAIHandlers.dubbing!(job("dubbing", { audioUrl: "https://example.com/a.mp3", targetLanguage: "fr" }) as never, ctx)
      .catch((e: unknown) => e)

    expect((err as Error).message).toBe("stop here: the service was asked")
  })
})
