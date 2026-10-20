import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => {
  // Cloud-replay seams (#643): default NOT connected so every local-path test
  // behaves as a keyed install; the cloud describe flips it per-test.
  const mockIsNodaroConnected = vi.fn().mockResolvedValue(false)
  const mockRunJobOnCloud = vi.fn()
  const mockSunoSeparate = vi.fn()
  const mockSunoSeparateMarket = vi.fn()
  const mockSeparateAudio = vi.fn()
  // Identity + prefix: the R2 url names the key it was stored under.
  const mockUploadToR2 = vi.fn(async (_url: string, key: string) => `https://r2.example.com/${key}.mp3`)
  const mockGetR2ObjectSize = vi.fn().mockResolvedValue(0)
  const mockR2KeyFromOurUrl = vi.fn().mockReturnValue(null)
  const mockIsOurMediaUrl = vi.fn().mockReturnValue(false)
  const mockSafeFetch = vi.fn()
  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockCommitJobCreditsAtChargedPrice = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockMarkJobCompleted = vi.fn().mockResolvedValue(true)
  return {
    mockIsNodaroConnected, mockRunJobOnCloud, mockSunoSeparate, mockSunoSeparateMarket, mockSeparateAudio,
    mockUploadToR2, mockGetR2ObjectSize, mockR2KeyFromOurUrl, mockIsOurMediaUrl, mockSafeFetch,
    mockCommitJobCredits, mockCommitJobCreditsAtChargedPrice, mockShouldSaveJobResult, mockMarkJobCompleted,
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/storage.js", () => ({
  uploadToR2: mocks.mockUploadToR2,
  getR2ObjectSize: mocks.mockGetR2ObjectSize,
  r2KeyFromOurUrl: mocks.mockR2KeyFromOurUrl,
}))
vi.mock("@/lib/safe-fetch.js", () => ({ safeFetch: mocks.mockSafeFetch }))
vi.mock("@/providers/nodaro/client.js", () => ({ isOurMediaUrl: mocks.mockIsOurMediaUrl }))
vi.mock("@/lib/nodaro-connect.js", () => ({ isNodaroConnected: mocks.mockIsNodaroConnected }))
vi.mock("@/providers/nodaro/run-on-cloud.js", () => ({ runJobOnCloud: mocks.mockRunJobOnCloud }))
vi.mock("@/providers/kie/suno-client.js", () => ({ sunoSeparate: mocks.mockSunoSeparate }))
// Partial: the error classes stay real so `instanceof` in the handler still works.
vi.mock("@/providers/kie/suno-separate-market.js", async (orig) => ({
  ...(await orig<typeof import("@/providers/kie/suno-separate-market.js")>()),
  sunoSeparateMarket: mocks.mockSunoSeparateMarket,
}))
vi.mock("@/providers/replicate/audio-separation.js", () => ({
  ReplicateAudioSeparationProvider: class {
    separateAudio = mocks.mockSeparateAudio
  },
}))
vi.mock("../../shared.js", () => ({
  commitJobCredits: mocks.mockCommitJobCredits,
  commitJobCreditsAtChargedPrice: mocks.mockCommitJobCreditsAtChargedPrice,
  shouldSaveJobResult: mocks.mockShouldSaveJobResult,
  markJobCompleted: mocks.mockMarkJobCompleted,
  setJobProgress: vi.fn().mockResolvedValue(undefined),
  withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
}))

import {
  handleSunoSeparate,
  demucsFallbackCreditId,
  pickSunoSeparateLane,
  demucsToSunoFields,
  sunoInputByteSize,
  sunoSeparateSourceOf,
} from "../suno-separate.js"
import type { SunoSeparateType } from "@nodaro/shared/models"
import { sunoHandlers } from "../suno.js"
import { config } from "@/lib/config.js"
import { DeterministicJobError } from "@/lib/deterministic-job-error.js"
import {
  SunoCatalogRefusalError,
  SunoAudioUnreachableError,
  SunoInputTooLargeError,
  SUNO_CATALOG_REFUSAL_MESSAGE,
  SUNO_CATALOG_REFUSAL_SINGLE_MESSAGE,
  SUNO_INPUT_TOO_LARGE_MESSAGE,
} from "@/providers/kie/suno-separate-market.js"

function makeJob(data: Record<string, unknown> = {}) {
  return { name: "suno-separate", data: { jobId: "job-1", ...data }, id: "bull-1", updateProgress: vi.fn() }
}

function makeCtx() {
  return { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false }
}

const run = (data: Record<string, unknown>) => handleSunoSeparate(makeJob(data) as never, makeCtx() as never)

/** The output_data the job completed with. */
function completedOutput(): Record<string, unknown> {
  expect(mocks.mockMarkJobCompleted).toHaveBeenCalledTimes(1)
  return (mocks.mockMarkJobCompleted.mock.calls[0]![1] as { output_data: Record<string, unknown> }).output_data
}

function headResponse(contentLength: string | null, ok = true) {
  return { ok, headers: { get: (h: string) => (h.toLowerCase() === "content-length" ? contentLength : null) } }
}

const MB = 1024 * 1024
const DEMUCS_STEMS = {
  vocals: "https://replicate.example/vocals.mp3",
  drums: "https://replicate.example/drums.mp3",
  bass: "https://replicate.example/bass.mp3",
  guitar: "https://replicate.example/guitar.mp3",
  piano: "https://replicate.example/piano.mp3",
  other: "https://replicate.example/other.mp3",
  cost: 0.01,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockSunoSeparate.mockResolvedValue({
    taskId: "suno-task-1",
    vocalUrl: "https://suno.example.com/vocal.mp3",
    instrumentalUrl: "https://suno.example.com/instrumental.mp3",
  })
  mocks.mockSunoSeparateMarket.mockResolvedValue({
    taskId: "market-task-1",
    vocalUrl: "https://kie.example.com/vocal.mp3",
    instrumentalUrl: "https://kie.example.com/instrumental.mp3",
  })
  mocks.mockSeparateAudio.mockResolvedValue(DEMUCS_STEMS)
  mocks.mockShouldSaveJobResult.mockResolvedValue(true)
  mocks.mockMarkJobCompleted.mockResolvedValue(true)
  mocks.mockIsOurMediaUrl.mockReturnValue(false)
  mocks.mockR2KeyFromOurUrl.mockReturnValue(null)
  mocks.mockGetR2ObjectSize.mockResolvedValue(0)
  // Unknown size by default: no content-length.
  mocks.mockSafeFetch.mockResolvedValue(headResponse(null))
})

describe("sunoSeparateSourceOf + pickSunoSeparateLane", () => {
  it.each([
    [{ taskId: "t", audioId: "a" }, "separate_vocal", "legacy"],
    [{ taskId: "t", audioId: "a" }, "split_stem", "legacy"],
    [{ taskId: "t", audioId: "a" }, "split_stem_advanced", "market-ids"],
    [{ taskId: "t", audioId: "a", audioUrl: "u" }, "separate_vocal", "legacy"],
    [{ audioUrl: "u" }, "split_stem", "market-url"],
    [{ audioUrl: "u" }, "split_stem_advanced", "market-url"],
    // A task id alone is a Suno track (its audio id defaults to the task id),
    // so a URL beside it is ignored — the shared rule, decided 2026-10-19.
    [{ taskId: "t", audioUrl: "u" }, "separate_vocal", "legacy"],
  ])("%j as %s → %s", (d, type, lane) =>
    expect(pickSunoSeparateLane(sunoSeparateSourceOf(d), type as SunoSeparateType)).toBe(lane))

  it("never carries both: ids drop the URL, a task id alone fills the audio id", () => {
    expect(sunoSeparateSourceOf({ taskId: "t", audioId: "a", audioUrl: "u" })).toEqual({ taskId: "t", audioId: "a" })
    expect(sunoSeparateSourceOf({ taskId: "t", audioUrl: "u" })).toEqual({ taskId: "t", audioId: "t" })
    expect(sunoSeparateSourceOf({ audioId: "a", audioUrl: "u" })).toEqual({ audioUrl: "u" })
  })

  it("no source → deterministic error with the connect-a-source copy", () => {
    expect(() => sunoSeparateSourceOf({})).toThrow(DeterministicJobError)
    expect(() => sunoSeparateSourceOf({ audioId: "a" })).toThrow("Connect a Suno track or any audio to separate.")
  })
})

it("demucsFallbackCreditId", () => {
  expect(demucsFallbackCreditId("separate_vocal")).toBe("audio-separation")
  expect(demucsFallbackCreditId("split_stem")).toBe("audio-separation:stems")
  expect(demucsFallbackCreditId("split_stem_advanced")).toBeNull()
})

describe("demucsToSunoFields", () => {
  it("maps every Demucs stem onto the Suno result field, other → otherUrl", () => {
    expect(demucsToSunoFields({ ...DEMUCS_STEMS, instrumental: "https://replicate.example/inst.mp3" })).toEqual({
      vocalUrl: "https://replicate.example/vocals.mp3",
      instrumentalUrl: "https://replicate.example/inst.mp3",
      drumsUrl: "https://replicate.example/drums.mp3",
      bassUrl: "https://replicate.example/bass.mp3",
      guitarUrl: "https://replicate.example/guitar.mp3",
      pianoUrl: "https://replicate.example/piano.mp3",
      otherUrl: "https://replicate.example/other.mp3",
    })
  })

  it("leaves out stems Demucs did not return", () => {
    expect(demucsToSunoFields({ vocals: "v", instrumental: "i", cost: null })).toEqual({ vocalUrl: "v", instrumentalUrl: "i" })
  })
})

describe("sunoInputByteSize", () => {
  it("our own media: the stored object's size, no HEAD", async () => {
    mocks.mockIsOurMediaUrl.mockReturnValue(true)
    mocks.mockR2KeyFromOurUrl.mockReturnValue("audio/x.mp3")
    mocks.mockGetR2ObjectSize.mockResolvedValue(25 * MB)
    await expect(sunoInputByteSize("https://media.nodaro.ai/audio/x.mp3")).resolves.toBe(25 * MB)
    expect(mocks.mockGetR2ObjectSize).toHaveBeenCalledWith("audio/x.mp3")
    expect(mocks.mockSafeFetch).not.toHaveBeenCalled()
  })

  it("our media the bucket cannot size falls through to a HEAD", async () => {
    mocks.mockIsOurMediaUrl.mockReturnValue(true)
    mocks.mockR2KeyFromOurUrl.mockReturnValue("audio/x.mp3")
    mocks.mockGetR2ObjectSize.mockResolvedValue(0)
    mocks.mockSafeFetch.mockResolvedValue(headResponse(String(3 * MB)))
    await expect(sunoInputByteSize("https://media.nodaro.ai/audio/x.mp3")).resolves.toBe(3 * MB)
  })

  it("other urls: a safe HEAD's content-length, with a 10 s timeout", async () => {
    mocks.mockSafeFetch.mockResolvedValue(headResponse(String(21 * MB)))
    await expect(sunoInputByteSize("https://example.com/song.mp3")).resolves.toBe(21 * MB)
    expect(mocks.mockIsOurMediaUrl).toHaveBeenCalledWith("https://example.com/song.mp3")
    expect(mocks.mockGetR2ObjectSize).not.toHaveBeenCalled()
    expect(mocks.mockSafeFetch).toHaveBeenCalledWith("https://example.com/song.mp3", { method: "HEAD", timeoutMs: 10_000 })
  })

  it.each([
    ["no content-length", () => mocks.mockSafeFetch.mockResolvedValue(headResponse(null))],
    ["a non-2xx answer", () => mocks.mockSafeFetch.mockResolvedValue(headResponse("999999999", false))],
    ["a zero length", () => mocks.mockSafeFetch.mockResolvedValue(headResponse("0"))],
    ["a garbage length", () => mocks.mockSafeFetch.mockResolvedValue(headResponse("lots"))],
    ["a refused HEAD", () => mocks.mockSafeFetch.mockRejectedValue(new Error("safeFetch: blocked"))],
  ])("unknown size on %s", async (_label, arrange) => {
    arrange()
    await expect(sunoInputByteSize("https://example.com/song.mp3")).resolves.toBeUndefined()
  })
})

describe("suno-separate handler", () => {
  it("is the registered suno-separate handler", () => {
    expect(sunoHandlers["suno-separate"]).toBe(handleSunoSeparate)
  })

  it("legacy lane is byte-identical: same sunoSeparate args, same keys, commitJobCredits", async () => {
    await run({ taskId: "suno-task-1", audioId: "audio-1", separateType: "separate_vocal" })

    expect(mocks.mockSunoSeparate).toHaveBeenCalledWith(
      { taskId: "suno-task-1", audioId: "audio-1", type: "separate_vocal" },
      expect.objectContaining({ onTaskCreated: expect.any(Function), modelKey: "suno-separate" }),
    )
    expect(mocks.mockSunoSeparateMarket).not.toHaveBeenCalled()
    expect(mocks.mockSafeFetch).not.toHaveBeenCalled()
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://suno.example.com/vocal.mp3", "job-1-vocal", "audio", "user-1")
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://suno.example.com/instrumental.mp3", "job-1-instrumental", "audio", "user-1")
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", {
      output_data: {
        separateType: "separate_vocal",
        sunoTaskId: "suno-task-1",
        vocalUrl: "https://r2.example.com/job-1-vocal.mp3",
        instrumentalUrl: "https://r2.example.com/job-1-instrumental.mp3",
        audioUrl: "https://r2.example.com/job-1-vocal.mp3",
        engineUsed: "suno",
      },
      provider: "kie",
    })
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
    expect(mocks.mockCommitJobCreditsAtChargedPrice).not.toHaveBeenCalled()
  })

  it("legacy lane defaults to separate_vocal when the payload has no type", async () => {
    await run({ taskId: "t", audioId: "a" })
    expect(mocks.mockSunoSeparate).toHaveBeenCalledWith({ taskId: "t", audioId: "a", type: "separate_vocal" }, expect.anything())
  })

  it.each<[Record<string, unknown>, "legacy" | "market", string]>([
    [{ taskId: "t", audioId: "a" }, "legacy", "suno-separate"],
    [{ taskId: "t", audioId: "a", separateType: "split_stem" }, "legacy", "suno-separate-stem"],
    [{ taskId: "t", audioId: "a", separateType: "split_stem_advanced" }, "market", "suno-separate-single"],
    [{ audioUrl: "https://example.com/a.mp3", separateType: "split_stem" }, "market", "suno-separate-stem"],
  ])("threads OUR modelKey into the create funnel %#", async (data, endpoint, expected) => {
    mocks.mockSunoSeparateMarket.mockResolvedValue({ taskId: "m", vocalUrl: "v", isolatedUrl: "i" })
    await run(data)
    const mock = endpoint === "market" ? mocks.mockSunoSeparateMarket : mocks.mockSunoSeparate
    expect(mock).toHaveBeenCalledTimes(1)
    const reconcileOpts = mock.mock.calls[0]![1] as { modelKey?: string; onTaskCreated?: unknown }
    expect(reconcileOpts.modelKey).toBe(expected)
    expect(reconcileOpts.onTaskCreated).toEqual(expect.any(Function))
  })

  it("market-url lane sends the audio and the type; output records the engine", async () => {
    await run({ audioUrl: "https://example.com/a.mp3", separateType: "separate_vocal" })
    expect(mocks.mockSunoSeparateMarket).toHaveBeenCalledWith(
      { source: { audioUrl: "https://example.com/a.mp3" }, type: "separate_vocal" },
      expect.objectContaining({ modelKey: "suno-separate" }),
    )
    expect(mocks.mockSunoSeparate).not.toHaveBeenCalled()
    const out = completedOutput()
    expect(out).toMatchObject({ engineUsed: "suno", sunoTaskId: "market-task-1", separateType: "separate_vocal" })
    expect(out).not.toHaveProperty("sunoRefused")
    expect(out).not.toHaveProperty("fallbackReason")
    expect(out).not.toHaveProperty("stemName")
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("market-ids lane: one instrument on a Suno track sends the ids and the stem name", async () => {
    mocks.mockSunoSeparateMarket.mockResolvedValue({
      taskId: "m-1",
      isolatedUrl: "https://kie.example.com/iso.mp3",
      withoutUrl: "https://kie.example.com/without.mp3",
      isolated2Url: "https://kie.example.com/iso2.mp3",
      without2Url: "https://kie.example.com/without2.mp3",
    })
    await run({ taskId: "t", audioId: "a", separateType: "split_stem_advanced", stemName: "Piano" })
    expect(mocks.mockSunoSeparateMarket).toHaveBeenCalledWith(
      { source: { taskId: "t", audioId: "a" }, type: "split_stem_advanced", stemName: "Piano" },
      expect.objectContaining({ modelKey: "suno-separate-single" }),
    )
    expect(completedOutput()).toEqual({
      separateType: "split_stem_advanced",
      stemName: "Piano",
      sunoTaskId: "m-1",
      isolatedUrl: "https://r2.example.com/job-1-isolated.mp3",
      withoutUrl: "https://r2.example.com/job-1-without.mp3",
      isolated2Url: "https://r2.example.com/job-1-isolated2.mp3",
      without2Url: "https://r2.example.com/job-1-without2.mp3",
      audioUrl: "https://r2.example.com/job-1-isolated.mp3",
      engineUsed: "suno",
    })
  })

  it("one-instrument mode without a stem name records the default", async () => {
    mocks.mockSunoSeparateMarket.mockResolvedValue({ taskId: "m-1", isolatedUrl: "https://kie.example.com/iso.mp3" })
    await run({ audioUrl: "https://example.com/a.mp3", separateType: "split_stem_advanced" })
    expect(mocks.mockSunoSeparateMarket.mock.calls[0]![0]).toEqual({
      source: { audioUrl: "https://example.com/a.mp3" },
      type: "split_stem_advanced",
      stemName: "Lead Vocal",
    })
    expect(completedOutput()).toMatchObject({ stemName: "Lead Vocal" })
  })

  it("primary audioUrl per mode: vocals for a split, isolated for one instrument", async () => {
    await run({ audioUrl: "https://example.com/a.mp3", separateType: "separate_vocal" })
    expect(completedOutput().audioUrl).toBe("https://r2.example.com/job-1-vocal.mp3")

    vi.clearAllMocks()
    mocks.mockShouldSaveJobResult.mockResolvedValue(true)
    mocks.mockMarkJobCompleted.mockResolvedValue(true)
    mocks.mockSafeFetch.mockResolvedValue(headResponse(null))
    mocks.mockSunoSeparateMarket.mockResolvedValue({ taskId: "m", isolatedUrl: "https://kie.example.com/iso.mp3", withoutUrl: "https://kie.example.com/w.mp3" })
    await run({ audioUrl: "https://example.com/a.mp3", separateType: "split_stem_advanced" })
    expect(completedOutput().audioUrl).toBe("https://r2.example.com/job-1-isolated.mp3")
  })

  it("full stems with no instrumental back: primary is vocals, instrumental stays absent", async () => {
    mocks.mockSunoSeparate.mockResolvedValue({ taskId: "t", vocalUrl: "https://s/v.mp3", drumsUrl: "https://s/d.mp3" })
    await run({ taskId: "t", audioId: "a", separateType: "split_stem" })
    const out = completedOutput()
    expect(out.audioUrl).toBe("https://r2.example.com/job-1-vocal.mp3")
    expect(out).not.toHaveProperty("instrumentalUrl")
    expect(out.drumsUrl).toBe("https://r2.example.com/job-1-drums.mp3")
  })

  it("one instrument with no isolated take is a failure, not a partial success", async () => {
    mocks.mockSunoSeparateMarket.mockResolvedValue({ taskId: "m", withoutUrl: "https://kie.example.com/w.mp3" })
    const err = await run({ audioUrl: "https://example.com/a.mp3", separateType: "split_stem_advanced" }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/no stems/)
    // A provider hiccup, not a pure function of the input: the queue may retry.
    expect(err).not.toBeInstanceOf(DeterministicJobError)
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
  })

  it("refusal, fallback off → SunoCatalogRefusalError, no demucs", async () => {
    mocks.mockSunoSeparateMarket.mockRejectedValue(new SunoCatalogRefusalError())
    const err = await run({ audioUrl: "https://example.com/a.mp3", separateType: "split_stem" }).catch((e) => e)
    expect(err).toBeInstanceOf(SunoCatalogRefusalError)
    expect((err as Error).message).toBe(SUNO_CATALOG_REFUSAL_MESSAGE)
    expect(mocks.mockSeparateAudio).not.toHaveBeenCalled()
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCreditsAtChargedPrice).not.toHaveBeenCalled()
  })

  it("refusal with fallback runs demucs and settles at the demucs price (full stems)", async () => {
    mocks.mockSunoSeparateMarket.mockRejectedValue(new SunoCatalogRefusalError())
    await run({ audioUrl: "https://example.com/a.mp3", separateType: "split_stem", fallbackToDemucs: true })

    expect(mocks.mockSeparateAudio).toHaveBeenCalledWith("https://example.com/a.mp3", { mode: "stems", quality: "auto" })
    // No reconcile wiring on the Demucs run: a crash fails + refunds rather
    // than being single-URL recovered (which would flatten the stems).
    expect(mocks.mockSeparateAudio.mock.calls[0]).toHaveLength(2)
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({ provider: "replicate" }))
    expect(completedOutput()).toEqual({
      separateType: "split_stem",
      vocalUrl: "https://r2.example.com/job-1-vocal.mp3",
      drumsUrl: "https://r2.example.com/job-1-drums.mp3",
      bassUrl: "https://r2.example.com/job-1-bass.mp3",
      guitarUrl: "https://r2.example.com/job-1-guitar.mp3",
      pianoUrl: "https://r2.example.com/job-1-piano.mp3",
      otherUrl: "https://r2.example.com/job-1-other.mp3",
      audioUrl: "https://r2.example.com/job-1-vocal.mp3",
      engineUsed: "demucs",
      sunoRefused: true,
      fallbackReason: "catalog",
    })
    expect(mocks.mockCommitJobCreditsAtChargedPrice).toHaveBeenCalledWith("usage-1", "job-1", "audio-separation:stems")
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })

  it("refusal with fallback on a vocal split runs demucs vocal_instrumental at the 2-stem price", async () => {
    mocks.mockSunoSeparateMarket.mockRejectedValue(new SunoCatalogRefusalError())
    mocks.mockSeparateAudio.mockResolvedValue({ vocals: "https://r/v.mp3", instrumental: "https://r/i.mp3", cost: null })
    await run({ audioUrl: "https://example.com/a.mp3", separateType: "separate_vocal", fallbackToDemucs: true })
    expect(mocks.mockSeparateAudio).toHaveBeenCalledWith("https://example.com/a.mp3", { mode: "vocal_instrumental", quality: "auto" })
    expect(completedOutput()).toMatchObject({
      vocalUrl: "https://r2.example.com/job-1-vocal.mp3",
      instrumentalUrl: "https://r2.example.com/job-1-instrumental.mp3",
      engineUsed: "demucs",
    })
    expect(mocks.mockCommitJobCreditsAtChargedPrice).toHaveBeenCalledWith("usage-1", "job-1", "audio-separation")
  })

  it("refusal in one-instrument mode never falls back, even with fallback on", async () => {
    mocks.mockSunoSeparateMarket.mockRejectedValue(new SunoCatalogRefusalError())
    const err = await run({
      audioUrl: "https://example.com/a.mp3", separateType: "split_stem_advanced", stemName: "Piano", fallbackToDemucs: true,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(SunoCatalogRefusalError)
    expect((err as Error).message).toBe(SUNO_CATALOG_REFUSAL_SINGLE_MESSAGE)
    expect(mocks.mockSeparateAudio).not.toHaveBeenCalled()
  })

  it("one-instrument refusal with fallback off gets the one-instrument copy too", async () => {
    mocks.mockSunoSeparateMarket.mockRejectedValue(new SunoCatalogRefusalError())
    await expect(run({ taskId: "t", audioId: "a", separateType: "split_stem_advanced" })).rejects.toThrow(SUNO_CATALOG_REFUSAL_SINGLE_MESSAGE)
  })

  it("an ids-lane job ignores a URL beside the ids: no size probe, and a refusal fails instead of falling back", async () => {
    mocks.mockSafeFetch.mockResolvedValue(headResponse(String(30 * MB)))
    // Suno does not refuse its own tracks; a refusal here proves the fallback
    // is gated on the URL lane, not on a URL being present.
    mocks.mockSunoSeparate.mockRejectedValue(new SunoCatalogRefusalError())
    await expect(run({
      taskId: "t", audioId: "a", audioUrl: "https://example.com/a.mp3", separateType: "split_stem", fallbackToDemucs: true,
    })).rejects.toBeInstanceOf(SunoCatalogRefusalError)
    expect(mocks.mockSafeFetch).not.toHaveBeenCalled()
    expect(mocks.mockSunoSeparate).toHaveBeenCalledWith({ taskId: "t", audioId: "a", type: "split_stem" }, expect.anything())
    expect(mocks.mockSeparateAudio).not.toHaveBeenCalled()
  })

  it("an unreachable-audio failure is never a fallback", async () => {
    mocks.mockSunoSeparateMarket.mockRejectedValue(new SunoAudioUnreachableError())
    await expect(
      run({ audioUrl: "https://example.com/a.mp3", separateType: "split_stem", fallbackToDemucs: true }),
    ).rejects.toBeInstanceOf(SunoAudioUnreachableError)
    expect(mocks.mockSeparateAudio).not.toHaveBeenCalled()
  })

  it("> 20 MB, fallback off: fails before calling KIE", async () => {
    mocks.mockSafeFetch.mockResolvedValue(headResponse(String(20 * MB + 1)))
    const err = await run({ audioUrl: "https://example.com/a.mp3", separateType: "split_stem" }).catch((e) => e)
    expect(err).toBeInstanceOf(SunoInputTooLargeError)
    expect((err as Error).message).toBe(SUNO_INPUT_TOO_LARGE_MESSAGE)
    expect(mocks.mockSunoSeparateMarket).not.toHaveBeenCalled()
    expect(mocks.mockSeparateAudio).not.toHaveBeenCalled()
  })

  it("> 20 MB, fallback on: goes to demucs with reason too_large, KIE never called", async () => {
    mocks.mockSafeFetch.mockResolvedValue(headResponse(String(30 * MB)))
    await run({ audioUrl: "https://example.com/a.mp3", separateType: "split_stem", fallbackToDemucs: true })
    expect(mocks.mockSunoSeparateMarket).not.toHaveBeenCalled()
    expect(mocks.mockSeparateAudio).toHaveBeenCalledWith("https://example.com/a.mp3", { mode: "stems", quality: "auto" })
    expect(completedOutput()).toMatchObject({ engineUsed: "demucs", sunoRefused: true, fallbackReason: "too_large" })
    expect(mocks.mockCommitJobCreditsAtChargedPrice).toHaveBeenCalledWith("usage-1", "job-1", "audio-separation:stems")
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })

  it("> 20 MB in one-instrument mode fails even with fallback on", async () => {
    mocks.mockSafeFetch.mockResolvedValue(headResponse(String(30 * MB)))
    await expect(
      run({ audioUrl: "https://example.com/a.mp3", separateType: "split_stem_advanced", fallbackToDemucs: true }),
    ).rejects.toBeInstanceOf(SunoInputTooLargeError)
    expect(mocks.mockSeparateAudio).not.toHaveBeenCalled()
    expect(mocks.mockSunoSeparateMarket).not.toHaveBeenCalled()
  })

  it("exactly 20 MB is allowed", async () => {
    mocks.mockSafeFetch.mockResolvedValue(headResponse(String(20 * MB)))
    await run({ audioUrl: "https://example.com/a.mp3", separateType: "split_stem" })
    expect(mocks.mockSunoSeparateMarket).toHaveBeenCalledTimes(1)
  })

  it("unknown size proceeds to KIE", async () => {
    mocks.mockSafeFetch.mockRejectedValue(new Error("network down"))
    await run({ audioUrl: "https://example.com/a.mp3", separateType: "split_stem" })
    expect(mocks.mockSunoSeparateMarket).toHaveBeenCalledTimes(1)
    expect(completedOutput()).toMatchObject({ engineUsed: "suno" })
  })

  it("cancelled mid-run: nothing completed, nothing committed", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValue(false)
    await run({ taskId: "t", audioId: "a" })
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })
})

describe("suno-separate on the connected cloud (#643)", () => {
  // The .env trap: a developer backend/.env carries a real KIE key, which would
  // silently route these tests down the LOCAL branch. Pin it, restore after.
  const originalKieKey = config.KIE_API_KEY

  beforeEach(() => {
    config.KIE_API_KEY = ""
    mocks.mockIsNodaroConnected.mockResolvedValue(true)
  })

  afterEach(() => {
    config.KIE_API_KEY = originalKieKey
    mocks.mockIsNodaroConnected.mockResolvedValue(false)
  })

  it("cloud stems are re-hosted into THIS instance's R2 under stem keys", async () => {
    mocks.mockRunJobOnCloud.mockResolvedValueOnce({
      separateType: "separate_vocal",
      vocalUrl: "https://cloud.example.com/v.mp3",
      instrumentalUrl: "https://cloud.example.com/i.mp3",
      audioUrl: "https://cloud.example.com/v.mp3",
      sunoTaskId: "cloud-task-9",
    })
    await run({ taskId: "t-1", audioId: "a-1", separateType: "separate_vocal" })

    expect(mocks.mockRunJobOnCloud).toHaveBeenCalledWith(
      "suno-separate",
      expect.objectContaining({ taskId: "t-1", audioId: "a-1", separateType: "separate_vocal" }),
      expect.any(Function),
    )
    expect(mocks.mockSunoSeparate).not.toHaveBeenCalled()
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://cloud.example.com/v.mp3", "job-1-vocal", "audio", "user-1")
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://cloud.example.com/i.mp3", "job-1-instrumental", "audio", "user-1")
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({ provider: "nodaro" }))
    expect(completedOutput()).toMatchObject({
      separateType: "separate_vocal",
      sunoTaskId: "cloud-task-9",
      vocalUrl: "https://r2.example.com/job-1-vocal.mp3",
      audioUrl: "https://r2.example.com/job-1-vocal.mp3",
    })
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("cloud return keeps takes and engine fields", async () => {
    mocks.mockRunJobOnCloud.mockResolvedValueOnce({
      isolatedUrl: "https://cloud.example.com/iso.mp3",
      withoutUrl: "https://cloud.example.com/w.mp3",
      isolated2Url: "https://cloud.example.com/iso2.mp3",
      sunoTaskId: "cloud-task-9",
      engineUsed: "suno",
    })
    await run({ audioUrl: "https://example.com/a.mp3", separateType: "split_stem_advanced", stemName: "Bass" })

    expect(mocks.mockSunoSeparateMarket).not.toHaveBeenCalled()
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://cloud.example.com/iso.mp3", "job-1-isolated", "audio", "user-1")
    expect(completedOutput()).toEqual({
      separateType: "split_stem_advanced",
      stemName: "Bass",
      sunoTaskId: "cloud-task-9",
      isolatedUrl: "https://r2.example.com/job-1-isolated.mp3",
      withoutUrl: "https://r2.example.com/job-1-without.mp3",
      isolated2Url: "https://r2.example.com/job-1-isolated2.mp3",
      audioUrl: "https://r2.example.com/job-1-isolated.mp3",
      engineUsed: "suno",
    })
  })

  it("a cloud Demucs fallback keeps its engine fields, its otherUrl, and settles at the Demucs price", async () => {
    mocks.mockRunJobOnCloud.mockResolvedValueOnce({
      vocalUrl: "https://cloud.example.com/v.mp3",
      otherUrl: "https://cloud.example.com/o.mp3",
      sunoTaskId: "cloud-task-9",
      engineUsed: "demucs",
      sunoRefused: true,
      fallbackReason: "catalog",
    })
    await run({ audioUrl: "https://example.com/a.mp3", separateType: "split_stem", fallbackToDemucs: true })
    expect(completedOutput()).toMatchObject({
      otherUrl: "https://r2.example.com/job-1-other.mp3",
      engineUsed: "demucs",
      sunoRefused: true,
      fallbackReason: "catalog",
    })
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({ provider: "nodaro" }))
    expect(mocks.mockCommitJobCreditsAtChargedPrice).toHaveBeenCalledWith("usage-1", "job-1", "audio-separation:stems")
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })

  it("an empty cloud result fails loudly instead of completing empty", async () => {
    mocks.mockRunJobOnCloud.mockResolvedValueOnce({ sunoTaskId: "x", engineUsed: "suno" })
    await expect(run({ taskId: "t", audioId: "a" })).rejects.toThrow("nodaro.ai returned no stems")
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
  })

  it("a cloud one-instrument result with no isolated take is a failure", async () => {
    mocks.mockRunJobOnCloud.mockResolvedValueOnce({ withoutUrl: "https://cloud.example.com/w.mp3" })
    await expect(run({ audioUrl: "https://example.com/a.mp3", separateType: "split_stem_advanced" })).rejects.toThrow(/no stems/)
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
  })

  it("the cloud lane runs no local size probe — the cloud checks its own input", async () => {
    mocks.mockRunJobOnCloud.mockResolvedValueOnce({ vocalUrl: "https://cloud.example.com/v.mp3" })
    await run({ audioUrl: "https://example.com/a.mp3", separateType: "separate_vocal" })
    expect(mocks.mockSafeFetch).not.toHaveBeenCalled()
  })
})
