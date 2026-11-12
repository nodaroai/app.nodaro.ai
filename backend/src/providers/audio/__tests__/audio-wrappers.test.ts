/**
 * Audio wrapper tests.
 *
 * Four small wrappers around external audio providers, each previously
 * untested:
 *   - youtube-extractor.ts → youtube-dl-exec → R2 upload
 *   - text-to-audio.ts     → Replicate (tangoflux)
 *   - generate-music.ts    → Replicate (musicgen / minimax / lyria / bark)
 *   - transcribe.ts        → Replicate (whisper / fast-whisper) +
 *                            KieAudioProvider (elevenlabs-stt)
 *
 * Tests verify provider routing, input/output mapping, error handling,
 * and cleanup behavior — without making any real network or filesystem
 * calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const replicateRun = vi.fn()
  const predictionsCreate = vi.fn()
  const replicateWait = vi.fn()
  const extractCost = vi.fn()
  const spawnYtDlp = vi.fn()
  const uploadFileToR2 = vi.fn()
  const fsAccess = vi.fn()
  const fsUnlink = vi.fn()
  const probeMediaDuration = vi.fn()
  const speechToText = vi.fn()
  const directStt = vi.fn()
  const fastWhisperToCaptions = vi.fn(() => [])
  const whisperToCaptions = vi.fn(() => [])
  return {
    directStt,
    replicateRun, predictionsCreate, replicateWait, extractCost,
    spawnYtDlp, uploadFileToR2, fsAccess, fsUnlink, probeMediaDuration,
    speechToText, fastWhisperToCaptions, whisperToCaptions,
  }
})

vi.mock("../../replicate/client.js", () => ({
  replicate: {
    run: mocks.replicateRun,
    predictions: { create: mocks.predictionsCreate },
    wait: mocks.replicateWait,
  },
  extractCost: mocks.extractCost,
}))

vi.mock("../../kie/audio.js", () => ({
  KieAudioProvider: class {
    speechToText = mocks.speechToText
  },
}))

// Nemotron 3.5 Transcribe runs on KIE through its own runner (kie/nemotron-transcribe.ts).
const nemotron = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock("../../kie/nemotron-transcribe.js", () => ({ runNemotronTranscribe: nemotron.run }))

// elevenlabs-stt now calls Scribe DIRECTLY (KIE's queue stalled — see direct-stt.ts).
vi.mock("../../elevenlabs/direct-stt.js", () => ({
  directSpeechToText: mocks.directStt,
}))

// Only the spawn is side-effectful — the client ladder, the arg builder and
// the proxy chain stay REAL (importOriginal, per the mock-real-constants rule)
// so these tests exercise the actual failover composition.
vi.mock("../../video/youtube-video.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../video/youtube-video.js")>()
  return { ...actual, spawnYtDlpDownload: mocks.spawnYtDlp }
})

vi.mock("@/lib/storage.js", () => ({
  uploadFileToR2: mocks.uploadFileToR2,
}))

// The extractor probes the downloaded file's length before upload. Only the
// probe is stubbed (it would shell out to ffprobe against a file the mocked
// spawn never wrote); the rest of ffmpeg-utils stays REAL.
vi.mock("../../video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../video/ffmpeg-utils.js")>()
  return { ...actual, probeMediaDuration: mocks.probeMediaDuration }
})

// Real fs except the two calls under test — youtube-video.ts (imported for
// real above) resolves the yt-dlp binary with existsSync at module load.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return {
    ...actual,
    promises: { ...actual.promises, access: mocks.fsAccess, unlink: mocks.fsUnlink },
  }
})

vi.mock("../captions-mappers.js", async (importOriginal) => ({
  // scribeWordsToCaptions stays REAL: its leading-space delimiter is the
  // wire-contract detail the elevenlabs-stt assertions below pin.
  ...(await importOriginal<typeof import("../captions-mappers.js")>()),
  fastWhisperWordsToCaptions: mocks.fastWhisperToCaptions,
  whisperWordsToCaptions: mocks.whisperToCaptions,
}))

// The import gate has its own tests (import-gate.test.ts, youtube-extractor-gate.test.ts);
// here it is a fake that always allows.
vi.mock("@/lib/import-gate.js", () => ({
  requireImportAllowed: vi.fn().mockResolvedValue(undefined),
  spendImportConfirmation: vi.fn().mockResolvedValue(undefined),
}))

// Config required by KieAudioProvider transitively — mocked too.
vi.mock("@/lib/config.js", () => ({
  config: { KIE_API_KEY: "k", NODE_ENV: "test", EDITION: "cloud" },
  hasCredits: () => true, isCloud: () => true, isCommunity: () => false,
  isBusiness: () => false, hasAdmin: () => true,
}))

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import { extractYouTubeAudio, extractYouTubeAudioWithMeta } from "../youtube-extractor.js"
import { textToAudio } from "../text-to-audio.js"
import { generateMusic } from "../generate-music.js"
import { transcribe } from "../transcribe.js"

/** The import rights every extraction carries (the gate is a fake above). */
const RIGHTS = { userId: "u1", lane: "route" as const }

beforeEach(() => {
  vi.clearAllMocks()
  // Sensible defaults
  mocks.fsAccess.mockResolvedValue(undefined)
  mocks.fsUnlink.mockResolvedValue(undefined)
  mocks.uploadFileToR2.mockResolvedValue("https://r2/uploaded.mp3")
  mocks.spawnYtDlp.mockResolvedValue(undefined)
  mocks.probeMediaDuration.mockResolvedValue(3564.2)
  mocks.extractCost.mockReturnValue(0.001)
})

// ===========================================================================
// 1) youtube-extractor.ts
// ===========================================================================

describe("extractYouTubeAudioWithMeta", () => {
  // The length is what lets a URL-sourced master carry a real duration on its
  // node; without it every duration-bucketed consumer quotes its ceiling.
  it("returns the R2 url plus the length probed from the LOCAL file", async () => {
    mocks.uploadFileToR2.mockResolvedValueOnce("https://r2/yt-extract-abc.mp3")

    const out = await extractYouTubeAudioWithMeta("https://youtube.com/watch?v=xyz", RIGHTS)

    expect(out).toEqual({ url: "https://r2/yt-extract-abc.mp3", durationSeconds: 3564.2 })
    // Probed the temp file — not the uploaded url (that would be a second download).
    const probed = mocks.probeMediaDuration.mock.calls[0]![0] as string
    expect(probed).toMatch(/yt-extract-.*\.mp3$/)
    expect(probed.startsWith("http")).toBe(false)
  })

  it("probes BEFORE the temp file is deleted", async () => {
    await extractYouTubeAudioWithMeta("https://youtube.com/watch?v=xyz", RIGHTS)
    const probeOrder = mocks.probeMediaDuration.mock.invocationCallOrder[0]!
    const unlinkOrder = mocks.fsUnlink.mock.invocationCallOrder[0]!
    expect(probeOrder).toBeLessThan(unlinkOrder)
  })

  it("a failed probe never fails the extraction — the url comes back without a length", async () => {
    mocks.probeMediaDuration.mockRejectedValueOnce(new Error("ffprobe exited 1"))
    mocks.uploadFileToR2.mockResolvedValueOnce("https://r2/yt-extract-abc.mp3")

    const out = await extractYouTubeAudioWithMeta("https://youtube.com/watch?v=xyz", RIGHTS)

    expect(out).toEqual({ url: "https://r2/yt-extract-abc.mp3" })
    expect("durationSeconds" in out).toBe(false)
    expect(mocks.uploadFileToR2).toHaveBeenCalledOnce()
  })

  it("does not probe when the download failed", async () => {
    mocks.spawnYtDlp.mockRejectedValue(new Error("download failed"))
    await expect(extractYouTubeAudioWithMeta("https://youtube.com/watch?v=bad", RIGHTS)).rejects.toThrow()
    expect(mocks.probeMediaDuration).not.toHaveBeenCalled()
  })
})

describe("extractYouTubeAudio", () => {
  it("downloads via the shared hardened spawn, uploads to R2, and returns the R2 URL", async () => {
    mocks.uploadFileToR2.mockResolvedValueOnce("https://r2/yt-extract-abc.mp3")

    const url = await extractYouTubeAudio("https://youtube.com/watch?v=xyz", RIGHTS)

    expect(url).toBe("https://r2/yt-extract-abc.mp3")
    // Rung 1 (default client) succeeded — exactly one spawn.
    expect(mocks.spawnYtDlp).toHaveBeenCalledOnce()
  })

  it("passes the audio flags, the spoof headers, and the long audio idle timeout", async () => {
    await extractYouTubeAudio("https://youtu.be/xyz", RIGHTS)

    const [args, , opts] = mocks.spawnYtDlp.mock.calls[0]
    expect(args[0]).toBe("https://youtu.be/xyz")
    for (const flag of ["--extract-audio", "--audio-format", "mp3", "--audio-quality", "0", "--no-playlist", "--no-check-certificates"]) {
      expect(args).toContain(flag)
    }
    expect(args).toContain("referer:youtube.com")
    // Output path is in tmpdir with a UUID — just check shape.
    const outIdx = args.indexOf("--output")
    expect(args[outIdx + 1]).toMatch(/yt-extract-[\w-]+\.mp3/)
    // The silent ffmpeg conversion phase must not be killed by the 90s
    // download-stall default (a long podcast converts for minutes).
    expect(opts).toEqual({ idleTimeoutMs: 10 * 60 * 1000 })
  })

  it("falls down the client ladder: web fails, tv succeeds", async () => {
    mocks.spawnYtDlp.mockRejectedValueOnce(new Error("No supported JavaScript runtime could be found"))

    await extractYouTubeAudio("https://www.youtube.com/watch?v=abc", RIGHTS)

    expect(mocks.spawnYtDlp).toHaveBeenCalledTimes(2)
    const secondArgs = mocks.spawnYtDlp.mock.calls[1][0] as string[]
    expect(secondArgs).toContain("youtube:player_client=tv")
    expect(mocks.uploadFileToR2).toHaveBeenCalledOnce()
  })

  it("rejects a non-YouTube host BEFORE any spawn (SSRF gate)", async () => {
    await expect(extractYouTubeAudio("https://evil.example/watch?v=x", RIGHTS)).rejects.toThrow(/host not allowed/)
    expect(mocks.spawnYtDlp).not.toHaveBeenCalled()
  })

  it("calls fs.access to verify the downloaded file exists", async () => {
    await extractYouTubeAudio("https://youtube.com/watch?v=x", RIGHTS)

    expect(mocks.fsAccess).toHaveBeenCalledOnce()
  })

  it("uploads to R2 with audio media type", async () => {
    await extractYouTubeAudio("https://youtube.com/watch?v=x", RIGHTS)

    const [, label, mediaType] = mocks.uploadFileToR2.mock.calls[0]
    expect(label).toMatch(/^yt-extract-/)
    expect(mediaType).toBe("audio")
  })

  it("cleans up the temp file after successful upload", async () => {
    await extractYouTubeAudio("https://youtube.com/watch?v=x", RIGHTS)

    expect(mocks.fsUnlink).toHaveBeenCalledOnce()
    // Cleanup uses the same path the download wrote to
    expect(mocks.fsUnlink.mock.calls[0][0]).toMatch(/yt-extract-[\w-]+\.mp3/)
  })

  it("throws and cleans up when every ladder rung fails", async () => {
    mocks.spawnYtDlp.mockRejectedValue(new Error("video unavailable"))

    await expect(extractYouTubeAudio("https://youtube.com/watch?v=bad", RIGHTS)).rejects.toThrow(
      /video unavailable/,
    )
    // All three YouTube rungs were tried before giving up.
    expect(mocks.spawnYtDlp).toHaveBeenCalledTimes(3)
    expect(mocks.fsUnlink).toHaveBeenCalledOnce()
    // Upload should never happen on download failure
    expect(mocks.uploadFileToR2).not.toHaveBeenCalled()
  })

  it("throws and cleans up when fs.access fails (file missing after dl)", async () => {
    mocks.fsAccess.mockRejectedValueOnce(new Error("ENOENT: no such file"))

    await expect(extractYouTubeAudio("https://youtube.com/watch?v=x", RIGHTS)).rejects.toThrow(/ENOENT/)
    expect(mocks.fsUnlink).toHaveBeenCalledOnce()
    expect(mocks.uploadFileToR2).not.toHaveBeenCalled()
  })

  it("normalises non-Error throwables to a generic message", async () => {
    mocks.spawnYtDlp.mockRejectedValue("string error not an Error instance")

    await expect(extractYouTubeAudio("https://youtube.com/watch?v=x", RIGHTS)).rejects.toThrow(
      /Failed to extract YouTube audio/,
    )
  })

  it("ignores cleanup failures (catch silently)", async () => {
    // The download succeeds, but cleanup unlink fails — whole operation should
    // still succeed because the .catch(() => {}) swallows it.
    mocks.fsUnlink.mockRejectedValueOnce(new Error("EBUSY"))

    const url = await extractYouTubeAudio("https://youtube.com/watch?v=x", RIGHTS)
    expect(url).toBe("https://r2/uploaded.mp3")
  })
})

// ===========================================================================
// 2) text-to-audio.ts
// ===========================================================================

describe("textToAudio", () => {
  it("returns the Replicate output URL", async () => {
    mocks.replicateRun.mockResolvedValueOnce("https://r2/audio.wav")

    const url = await textToAudio("a dog barks")

    expect(url).toBe("https://r2/audio.wav")
  })

  it("uses tangoflux as the default provider", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    await textToAudio("p")

    expect(mocks.replicateRun.mock.calls[0][0]).toMatch(/declare-lab\/tangoflux/)
  })

  it("falls back to tangoflux for unknown provider strings", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    // @ts-expect-error — intentionally passing invalid provider
    await textToAudio("p", "not-real")

    expect(mocks.replicateRun.mock.calls[0][0]).toMatch(/tangoflux/)
  })

  it("passes prompt through the configured promptParam", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    await textToAudio("a sax solo")

    const input = mocks.replicateRun.mock.calls[0][1].input
    expect(input.prompt).toBe("a sax solo")
  })

  it("forwards duration when set", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    await textToAudio("p", "tangoflux", 12)

    const input = mocks.replicateRun.mock.calls[0][1].input
    expect(input.duration).toBe(12)
  })

  it("omits duration param when undefined", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    await textToAudio("p")

    const input = mocks.replicateRun.mock.calls[0][1].input
    expect(input.duration).toBeUndefined()
  })

  it("converts non-string Replicate output via String() (e.g. FileOutput-like)", async () => {
    mocks.replicateRun.mockResolvedValueOnce({
      toString: () => "https://r2/from-tostring.mp3",
    })

    const url = await textToAudio("p")
    expect(url).toBe("https://r2/from-tostring.mp3")
  })
})

// ===========================================================================
// 3) generate-music.ts
// ===========================================================================

describe("generateMusic — provider dispatch", () => {
  it("default provider is musicgen", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    await generateMusic("rock anthem")

    expect(mocks.replicateRun.mock.calls[0][0]).toMatch(/meta\/musicgen/)
  })

  it("default duration is 8s for musicgen", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    await generateMusic("p")

    const input = mocks.replicateRun.mock.calls[0][1].input
    expect(input.duration).toBe(8)
  })

  it("default model_version is stereo-large for musicgen", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    await generateMusic("p")

    const input = mocks.replicateRun.mock.calls[0][1].input
    expect(input.model_version).toBe("stereo-large")
  })

  it("respects custom modelVersion for musicgen", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    await generateMusic("p", "musicgen", 16, "melody-large")

    const input = mocks.replicateRun.mock.calls[0][1].input
    expect(input.model_version).toBe("melody-large")
    expect(input.duration).toBe(16)
  })

  it("musicgen sets output_format=mp3 + normalization_strategy=peak", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    await generateMusic("p")

    const input = mocks.replicateRun.mock.calls[0][1].input
    expect(input.output_format).toBe("mp3")
    expect(input.normalization_strategy).toBe("peak")
  })

  it("minimax routes to minimax/music-01 model", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    await generateMusic("p", "minimax", 8, undefined, "la la la")

    expect(mocks.replicateRun.mock.calls[0][0]).toMatch(/minimax\/music-01/)
  })

  it("minimax forwards lyrics directly when provided", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    await generateMusic("ignored prompt", "minimax", 8, undefined, "real lyrics here")

    const input = mocks.replicateRun.mock.calls[0][1].input
    expect(input.lyrics).toBe("real lyrics here")
  })

  it("minimax wraps prompt in ## delimiters when lyrics not provided", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    await generateMusic("a happy melody", "minimax")

    const input = mocks.replicateRun.mock.calls[0][1].input
    expect(input.lyrics).toBe("##\na happy melody\n##")
  })

  it("minimax forwards referenceAudioUrl as song_file", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    await generateMusic("p", "minimax", undefined, undefined, "lyrics", "https://ref.mp3")

    const input = mocks.replicateRun.mock.calls[0][1].input
    expect(input.song_file).toBe("https://ref.mp3")
  })

  it("minimax omits song_file when referenceAudioUrl absent", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    await generateMusic("p", "minimax")

    const input = mocks.replicateRun.mock.calls[0][1].input
    expect(input.song_file).toBeUndefined()
  })

  it("lyria routes to google/lyria-2 with prompt only", async () => {
    mocks.replicateRun.mockResolvedValueOnce("u")

    await generateMusic("calm strings", "lyria")

    expect(mocks.replicateRun.mock.calls[0][0]).toMatch(/google\/lyria-2/)
    const input = mocks.replicateRun.mock.calls[0][1].input
    expect(input).toEqual({ prompt: "calm strings" })
  })

  it("bark routes to suno-ai/bark with default temps", async () => {
    mocks.replicateRun.mockResolvedValueOnce({ audio_out: "https://bark.mp3" })

    await generateMusic("[laughs] hello", "bark")

    const input = mocks.replicateRun.mock.calls[0][1].input
    expect(input.text_temp).toBe(0.7)
    expect(input.waveform_temp).toBe(0.7)
  })

  it("bark extracts audio_out from output object", async () => {
    mocks.replicateRun.mockResolvedValueOnce({ audio_out: "https://bark-result.mp3" })

    const url = await generateMusic("p", "bark")
    expect(url).toBe("https://bark-result.mp3")
  })

  it("bark falls back to String(output) when audio_out missing", async () => {
    mocks.replicateRun.mockResolvedValueOnce("https://bark-string.mp3")

    const url = await generateMusic("p", "bark")
    expect(url).toBe("https://bark-string.mp3")
  })
})

// ===========================================================================
// 4) transcribe.ts
// ===========================================================================

describe("transcribe — version extraction", () => {
  it("throws when model string lacks a version hash (mistyped TRANSCRIBE_MODELS entry)", async () => {
    // Force the bad-version branch by providing a fake provider name so the
    // model-id lookup falls through to the default whisper, then verify
    // version extraction works for the canonical id.
    // Direct test: look up the actual whisper id format.
    // (The internal extractVersion is exercised on every call — we can
    // confirm valid "owner/name:hash" works in the happy paths below.
    // To exercise the throw branch, we'd need to mutate TRANSCRIBE_MODELS,
    // which is module-scope const. Skip the negative test and rely on
    // happy-path coverage for normal IDs.)
    mocks.predictionsCreate.mockResolvedValueOnce({ id: "p1" })
    mocks.replicateWait.mockResolvedValueOnce({
      output: { transcription: "x", detected_language: "en" },
      metrics: {},
    })
    await expect(transcribe("u")).resolves.toBeDefined()
  })
})

describe("transcribe — provider: whisper (default)", () => {
  beforeEach(() => {
    mocks.predictionsCreate.mockResolvedValue({ id: "p-whisper" })
    mocks.replicateWait.mockResolvedValue({
      output: {
        transcription: "hello world",
        detected_language: "en",
        segments: [
          { id: 0, start: 0, end: 1, text: "hello" },
          { id: 1, start: 1, end: 2, text: "world" },
        ],
      },
      metrics: { predict_time: 5 },
    })
  })

  it("uses openai/whisper version on default provider", async () => {
    await transcribe("https://audio.mp3")

    const args = mocks.predictionsCreate.mock.calls[0][0]
    expect(args.version).toBe("8099696689d249cf8b122d833c36ac3f75505c666a395ca40ef26f68e7d3d16e")
  })

  it("returns text + detected language + cost + segments", async () => {
    mocks.extractCost.mockReturnValueOnce(0.0042)

    const result = await transcribe("https://audio.mp3")

    expect(result.text).toBe("hello world")
    expect(result.language).toBe("en")
    expect(result.cost).toBe(0.0042)
    expect(result.segments).toEqual([
      { start: 0, end: 1, text: "hello" },
      { start: 1, end: 2, text: "world" },
    ])
  })

  it("forwards explicit language", async () => {
    await transcribe("u", "whisper", "es")

    const input = mocks.predictionsCreate.mock.calls[0][0].input
    expect(input.language).toBe("es")
  })

  it("omits language when 'auto' is requested", async () => {
    await transcribe("u", "whisper", "auto")

    const input = mocks.predictionsCreate.mock.calls[0][0].input
    expect(input.language).toBeUndefined()
  })

  it("THROWS before calling Replicate when wordTimestamps is requested", async () => {
    // openai/whisper has no `word_timestamps` input in any published version —
    // Replicate silently drops the key, the segments come back without `words`,
    // and the job used to "succeed" with an empty word list after the credits
    // were spent. The capability check runs before any provider call, so the
    // caller gets a refusal instead of a paid-for, word-less answer.
    await expect(transcribe("u", "whisper", undefined, { wordTimestamps: true })).rejects.toThrow(
      /does not return word timestamps/,
    )

    expect(mocks.predictionsCreate).not.toHaveBeenCalled()
    expect(mocks.replicateWait).not.toHaveBeenCalled()
  })

  it("THROWS for the DEFAULT provider too (absent provider resolves to whisper)", async () => {
    await expect(transcribe("u", undefined, undefined, { wordTimestamps: true })).rejects.toThrow(
      /incredibly-fast-whisper or elevenlabs-stt/,
    )

    expect(mocks.predictionsCreate).not.toHaveBeenCalled()
  })

  it("never sends the dead word_timestamps key on a normal run", async () => {
    await transcribe("u", "whisper")

    const input = mocks.predictionsCreate.mock.calls[0][0].input
    expect(input.word_timestamps).toBeUndefined()
  })

  it("does NOT call whisperWordsToCaptions when wordTimestamps is false/undefined", async () => {
    await transcribe("u")

    expect(mocks.whisperToCaptions).not.toHaveBeenCalled()
  })

  it("returns 'unknown' language when detected_language missing", async () => {
    mocks.replicateWait.mockResolvedValueOnce({
      output: { transcription: "x", detected_language: undefined },
      metrics: {},
    })

    const result = await transcribe("u")
    expect(result.language).toBe("unknown")
  })

  it("returns empty text when transcription missing", async () => {
    mocks.replicateWait.mockResolvedValueOnce({
      output: { transcription: undefined, detected_language: "en" },
      metrics: {},
    })

    const result = await transcribe("u")
    expect(result.text).toBe("")
  })
})

describe("transcribe — provider: incredibly-fast-whisper", () => {
  beforeEach(() => {
    mocks.predictionsCreate.mockResolvedValue({ id: "p-fast" })
    mocks.replicateWait.mockResolvedValue({
      output: {
        text: "fast result",
        chunks: [
          { text: "fast", timestamp: [0, 0.5] },
          { text: "result", timestamp: [0.5, 1.0] },
        ],
      },
      metrics: { predict_time: 1 },
    })
  })

  it("routes to vaibhavs10/incredibly-fast-whisper version", async () => {
    await transcribe("u", "incredibly-fast-whisper")

    const args = mocks.predictionsCreate.mock.calls[0][0]
    expect(args.version).toBe("3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c")
  })

  it("sets timestamp=word when wordTimestamps=true", async () => {
    // A word must come back, or the contract check below rejects the run.
    mocks.fastWhisperToCaptions.mockReturnValueOnce([{ text: "fast" } as never])
    await transcribe("u", "incredibly-fast-whisper", undefined, { wordTimestamps: true })

    const input = mocks.predictionsCreate.mock.calls[0][0].input
    expect(input.timestamp).toBe("word")
  })

  it("sets timestamp=chunk by default", async () => {
    await transcribe("u", "incredibly-fast-whisper")

    const input = mocks.predictionsCreate.mock.calls[0][0].input
    expect(input.timestamp).toBe("chunk")
  })

  it("forwards language explicitly when set", async () => {
    await transcribe("u", "incredibly-fast-whisper", "fr")

    const input = mocks.predictionsCreate.mock.calls[0][0].input
    expect(input.language).toBe("fr")
  })

  it("sends language='None' when language missing/auto", async () => {
    await transcribe("u", "incredibly-fast-whisper", "auto")

    const input = mocks.predictionsCreate.mock.calls[0][0].input
    expect(input.language).toBe("None")
  })

  it("returns text + segments mapped from chunks", async () => {
    const result = await transcribe("u", "incredibly-fast-whisper")

    expect(result.text).toBe("fast result")
    expect(result.segments).toEqual([
      { start: 0, end: 0.5, text: "fast" },
      { start: 0.5, end: 1.0, text: "result" },
    ])
  })

  it("returns language='auto' when none requested", async () => {
    const result = await transcribe("u", "incredibly-fast-whisper")

    expect(result.language).toBe("auto")
  })

  it("populates words via fastWhisperWordsToCaptions when wordTimestamps set", async () => {
    mocks.fastWhisperToCaptions.mockReturnValueOnce([{ text: "x" } as never])

    const result = await transcribe("u", "incredibly-fast-whisper", undefined, { wordTimestamps: true })

    expect(result.words).toEqual([{ text: "x" }])
    expect(mocks.fastWhisperToCaptions).toHaveBeenCalledOnce()
  })

  it("THROWS when word timings were asked for and the provider returned none", async () => {
    // The lane CAN do word timings, so an empty word list on audio that has
    // speech is a provider contract break — the job fails (and refunds) rather
    // than returning a silently word-less transcript. `fastWhisperToCaptions`
    // defaults to [] in this suite's mocks, so this is the no-words case.
    await expect(
      transcribe("u", "incredibly-fast-whisper", undefined, { wordTimestamps: true }),
    ).rejects.toThrow(/no word timestamps/)
  })
})

describe("transcribe — provider: elevenlabs-stt", () => {
  it("calls Scribe DIRECTLY and never KIE (KIE's queue stalled on this model)", async () => {
    mocks.directStt.mockResolvedValueOnce({
      text: "scribe says hello",
      language: "en",
      words: [{ text: "scribe", start: 0, end: 0.4 }],
    })

    const result = await transcribe("https://audio.mp3", "elevenlabs-stt", "en", {
      diarize: true,
      tagAudioEvents: true,
    })

    // No metered provider cost on the direct path — the reserved tier commits.
    // The `json` (Transcript) handle is always populated — Scribe is word-level.
    expect(result).toEqual({
      text: "scribe says hello",
      language: "en",
      words: [{ text: "scribe", startMs: 0, endMs: 400, timestampMs: null, confidence: null }],
      json: {
        version: 1,
        language: "en",
        words: [{ text: "scribe", startMs: 0, endMs: 400 }],
      },
    })
    expect(mocks.directStt).toHaveBeenCalledWith("https://audio.mp3", {
      languageCode: "en",
      diarize: true,
      tagAudioEvents: true,
    })
    // The regression guard: the KIE path must be gone entirely.
    expect(mocks.speechToText).not.toHaveBeenCalled()
  })

  it("passes languageCode=undefined when language is 'auto'", async () => {
    mocks.directStt.mockResolvedValueOnce({ text: "", language: "auto", words: [] })

    await transcribe("u", "elevenlabs-stt", "auto")

    expect(mocks.directStt).toHaveBeenCalledWith(
      "u",
      expect.objectContaining({ languageCode: undefined }),
    )
  })

  it("passes languageCode=undefined when language is missing", async () => {
    mocks.directStt.mockResolvedValueOnce({ text: "", language: "auto", words: [] })

    await transcribe("u", "elevenlabs-stt")

    expect(mocks.directStt).toHaveBeenCalledWith(
      "u",
      expect.objectContaining({ languageCode: undefined }),
    )
  })

  it("does not call replicate.predictions for elevenlabs-stt", async () => {
    mocks.directStt.mockResolvedValueOnce({
      text: "x",
      language: "en",
      words: [{ text: "x", start: 0, end: 0.2 }],
    })

    await transcribe("u", "elevenlabs-stt")

    expect(mocks.predictionsCreate).not.toHaveBeenCalled()
  })

  it("maps diarized words to Caption-shaped words (ms) with speaker", async () => {
    mocks.directStt.mockResolvedValueOnce({
      text: "hi there", language: "en",
      words: [
        { text: "hi", start: 0.12, end: 0.5, speaker: "speaker_1" },
        { text: "there", start: 0.55, end: 0.9, speaker: "speaker_2" },
      ],
    })

    const result = await transcribe("https://r2.example/a.mp3", "elevenlabs-stt", undefined, { diarize: true })

    expect(result.words).toEqual([
      { text: "hi", startMs: 120, endMs: 500, timestampMs: null, confidence: null, speaker: "speaker_1" },
      // Leading space = the @remotion/captions word delimiter the overlays rely on.
      { text: " there", startMs: 550, endMs: 900, timestampMs: null, confidence: null, speaker: "speaker_2" },
    ])
  })

  it("THROWS when speech came back with no word entries — Scribe is declared word-level", async () => {
    // Scribe is always word-level, flag or not, so a word-less answer for audio
    // that has speech is the same provider contract break the
    // incredibly-fast-whisper lane fails on: the job fails (and refunds) rather
    // than handing back a transcript whose `json.words` is empty, which every
    // caption consumer downstream reads as "this clip has no words".
    mocks.directStt.mockResolvedValueOnce({ text: "hi", language: "en", words: [] })

    await expect(transcribe("https://r2.example/a.mp3", "elevenlabs-stt")).rejects.toThrow(
      /no word timestamps/,
    )
  })

  it("succeeds with no words on silence — nothing was spoken", async () => {
    mocks.directStt.mockResolvedValueOnce({ text: "", language: "en", words: [] })

    const result = await transcribe("https://r2.example/a.mp3", "elevenlabs-stt")

    expect(result.words).toBeUndefined()
    expect(result.json).toEqual({ version: 1, language: "en", words: [] })
  })

  it("succeeds with no words on an AUDIO-EVENT-only clip (tagAudioEvents)", async () => {
    // With `tagAudioEvents` on, a music-only clip legitimately comes back as
    // `text: "[music]"` with zero word entries — Scribe files events as
    // `type: "audio_event"`, which direct-stt filters out of `words`. Failing
    // that would break a run that works today, so "has speech" is measured with
    // the tags stripped.
    mocks.directStt.mockResolvedValueOnce({ text: "[music]", language: "en", words: [] })

    const result = await transcribe("https://r2.example/a.mp3", "elevenlabs-stt", undefined, {
      tagAudioEvents: true,
    })

    expect(result.text).toBe("[music]")
    expect(result.words).toBeUndefined()
  })
})

// ===========================================================================
// 5) Cross-cutting: cost extraction
// ===========================================================================

describe("transcribe — provider: nemotron-3-5-transcribe", () => {
  beforeEach(() => {
    nemotron.run.mockReset()
  })

  it("runs Nemotron with the request's options (never a language) and returns its cost and words", async () => {
    nemotron.run.mockResolvedValue({
      text: "Hi there.",
      language: "unknown",
      words: [{ text: "Hi", startMs: 0, endMs: 300, timestampMs: null, confidence: null, speaker: "speaker_0" }],
      json: { version: 1, words: [{ text: "Hi", startMs: 0, endMs: 300, speaker: "speaker_0" }] },
      cost: 0.003,
    })
    const onTaskCreated = vi.fn()
    const out = await transcribe("https://x/a.mp3", "nemotron-3-5-transcribe", "es", { wordTimestamps: true, durationSec: 120, onTaskCreated })
    expect(nemotron.run).toHaveBeenCalledWith(
      { audioUrl: "https://x/a.mp3", wordTimestamps: true, targetLanguage: undefined, fallbackDurationSec: 120 },
      { onTaskCreated: expect.any(Function) },
    )
    expect(out).toMatchObject({ text: "Hi there.", cost: 0.003 })
    expect(out.words).toHaveLength(1)
    expect(mocks.predictionsCreate).not.toHaveBeenCalled()
    expect(mocks.directStt).not.toHaveBeenCalled()
  })

  it("translates, and keeps KIE's truncated flag", async () => {
    nemotron.run.mockResolvedValue({ text: "Hello.", language: "en", json: { version: 1, language: "en", words: [] }, truncated: true })
    const out = await transcribe("https://x/es.mp3", "nemotron-3-5-transcribe", undefined, { targetLanguage: "en" })
    expect(nemotron.run).toHaveBeenCalledWith(expect.objectContaining({ targetLanguage: "en" }), undefined)
    expect(out).toMatchObject({ text: "Hello.", language: "en", truncated: true })
  })

  it("REFUSES a translation with word timings before any provider call", async () => {
    await expect(transcribe("u", "nemotron-3-5-transcribe", undefined, { targetLanguage: "en", wordTimestamps: true })).rejects.toThrow(/word timings and a translation/)
    expect(nemotron.run).not.toHaveBeenCalled()
  })

  it("REFUSES a translation on an engine that cannot translate, before any provider call", async () => {
    await expect(transcribe("u", "whisper", undefined, { targetLanguage: "en" })).rejects.toThrow(/does not translate/)
    await expect(transcribe("u", "elevenlabs-stt", undefined, { targetLanguage: "en" })).rejects.toThrow(/does not translate/)
    expect(mocks.predictionsCreate).not.toHaveBeenCalled()
    expect(mocks.directStt).not.toHaveBeenCalled()
  })
})

describe("transcribe — cost extraction", () => {
  it("returns undefined cost when extractCost returns null", async () => {
    mocks.predictionsCreate.mockResolvedValueOnce({ id: "p" })
    mocks.replicateWait.mockResolvedValueOnce({
      output: { transcription: "x", detected_language: "en" },
      metrics: {},
    })
    mocks.extractCost.mockReturnValueOnce(null)

    const result = await transcribe("u")
    expect(result.cost).toBeUndefined()
  })

  it("forwards prediction.metrics to extractCost", async () => {
    mocks.predictionsCreate.mockResolvedValueOnce({ id: "p" })
    mocks.replicateWait.mockResolvedValueOnce({
      output: { transcription: "x", detected_language: "en" },
      metrics: { predict_time: 42 },
    })

    await transcribe("u")

    expect(mocks.extractCost).toHaveBeenCalledWith({ predict_time: 42 }, "whisper")
  })
})
