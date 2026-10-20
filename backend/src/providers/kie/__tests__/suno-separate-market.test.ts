/**
 * Suno Separate on the market lane (`ai-music-api/separate-vocals` through
 * `jobs/createTask` + `jobs/recordInfo`): the request body for each source
 * lane, the parser over the probe's real wire shapes, and the typed refusals.
 *
 * The record fixtures are the probe's recorded `jobs/recordInfo` responses
 * (their tempfile URLs have long expired); the two failure records are
 * hand-made from KIE's exact fail text.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: {
    KIE_API_KEY: "test-kie-key",
    KIE_API_BASE_URL: "https://api.kie.ai",
    NODE_ENV: "test",
    EDITION: "cloud",
  },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import { SUNO_SEPARATE_STEM_FIELDS } from "@nodaro/shared/models"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { KieError } from "../client.js"
import {
  parseSeparateVocalsResult,
  sunoSeparateMarket,
  SunoCatalogRefusalError,
  SunoAudioUnreachableError,
  SunoInputTooLargeError,
  SUNO_CATALOG_REFUSAL_MESSAGE,
  SUNO_CATALOG_REFUSAL_SINGLE_MESSAGE,
  SUNO_AUDIO_UNREACHABLE_MESSAGE,
  SUNO_INPUT_TOO_LARGE_MESSAGE,
} from "../suno-separate-market.js"
import separateVocalRecord from "./fixtures/suno-separate/separate_vocal.record.json"
import splitStemRecord from "./fixtures/suno-separate/split_stem.record.json"
import splitStemAdvancedRecord from "./fixtures/suno-separate/split_stem_advanced.record.json"
import catalogRefusalRecord from "./fixtures/suno-separate/catalog-refusal.record.json"
import unreachableRecord from "./fixtures/suno-separate/unreachable.record.json"

const FIXTURES = {
  separate_vocal: separateVocalRecord,
  split_stem: splitStemRecord,
  split_stem_advanced: splitStemAdvancedRecord,
  "catalog-refusal": catalogRefusalRecord,
  unreachable: unreachableRecord,
} as const

function fixture(name: keyof typeof FIXTURES): { data: { resultJson?: string | null } } {
  return FIXTURES[name] as { data: { resultJson?: string | null } }
}

function resultJsonOf(record: { data: { resultJson?: string | null } }): unknown {
  return JSON.parse(record.data.resultJson as string)
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function withTimers<T>(fn: () => Promise<T>, advanceMs = 600_000): Promise<T> {
  const promise = fn()
  promise.catch(() => undefined)
  await vi.advanceTimersByTimeAsync(advanceMs)
  return promise
}

/** createTask answers with a taskId; every recordInfo poll answers with `record`. */
function mockCreateThenRecord(record: unknown, taskId = "t-sep"): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/jobs/createTask")) {
      return new Response(JSON.stringify({ code: 200, data: { taskId } }), { status: 200 })
    }
    if (url.includes("/jobs/recordInfo")) {
      return new Response(JSON.stringify(record), { status: 200 })
    }
    throw new Error(`unexpected url ${url}`)
  })
}

function createTaskBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/jobs/createTask"))
  expect(call, "createTask was called").toBeDefined()
  return JSON.parse((call![1] as { body: string }).body) as Record<string, unknown>
}

describe("parseSeparateVocalsResult", () => {
  it("parses separate_vocal", () => {
    const r = parseSeparateVocalsResult(resultJsonOf(fixture("separate_vocal")), "separate_vocal", "t")
    expect(r.taskId).toBe("t")
    expect(r.vocalUrl).toMatch(/_Vocals\.mp3$/)
    expect(r.instrumentalUrl).toMatch(/_Instrumental\.mp3$/)
  })

  it("parses split_stem with Backing_Vocals (12 stems, none dropped)", () => {
    const r = parseSeparateVocalsResult(resultJsonOf(fixture("split_stem")), "split_stem", "t")
    expect(r.backingVocalsUrl).toMatch(/Backing_Vocals\.mp3$/)
    expect(SUNO_SEPARATE_STEM_FIELDS.filter((f) => r[f])).toHaveLength(12)
  })

  it("parses split_stem_advanced into two takes, URLs percent-encoded", () => {
    const r = parseSeparateVocalsResult(resultJsonOf(fixture("split_stem_advanced")), "split_stem_advanced", "t")
    expect(r.isolatedUrl).toMatch(/_Lead%20Vocal\.mp3$/)
    expect(r.withoutUrl).toBeDefined()
    expect(r.isolated2Url).toBeDefined()
    expect(r.without2Url).toBeDefined()
    expect(new Set([r.isolatedUrl, r.withoutUrl, r.isolated2Url, r.without2Url]).size).toBe(4)
    expect(r.vocalUrl).toBeUndefined()
    // Take 1 is entry 0: extract → isolated, remove → without.
    expect(r.isolatedUrl).toContain("9eb0233a-5e6c-4714-9ba3-e29b85b426ef")
    expect(r.withoutUrl).toContain("d9669123-42ea-4dba-bc6d-28268bd8bb02")
    expect(r.isolated2Url).toContain("76928861-fd4c-40a3-bc26-dd9f294bd6ee")
    expect(r.without2Url).toContain("662e50ab-4efb-4e09-bf80-66aefffbaf16")
  })

  it("encodes only literal spaces — existing escapes and query strings pass through unchanged", () => {
    const signed = "https://x/r/a%2Fb.mp3?sig=ab%2Bcd%3D&exp=1"
    const r = parseSeparateVocalsResult(
      { resultObject: { origin_data: [
        { stem_type_group_name: "Vocals", audio_url: "https://x/r/a_Lead%20Vocal.mp3" },
        { stem_type_group_name: "Instrumental", audio_url: signed },
        { stem_type_group_name: "Drums", audio_url: "https://x/r/b 100%.mp3" },
        { stem_type_group_name: "Bass", audio_url: "https://x/r/9eb0_Lead Vocal.mp3" },
      ] } },
      "split_stem",
      "t",
    )
    expect(r.vocalUrl).toBe("https://x/r/a_Lead%20Vocal.mp3")
    // Reserved-character escapes are never re-encoded (%2F → %252F would break a signature).
    expect(r.instrumentalUrl).toBe(signed)
    expect(r.drumsUrl).toBe("https://x/r/b%20100%.mp3")
    expect(r.bassUrl).toBe("https://x/r/9eb0_Lead%20Vocal.mp3")
  })

  it("skips entries with a non-string stem name or URL", () => {
    const r = parseSeparateVocalsResult(
      { resultObject: { origin_data: [
        { stem_type_group_name: 7, audio_url: "https://x/a.mp3" },
        { stem_type_group_name: "Drums", audio_url: null },
        { stem_type_group_name: "Bass", audio_url: "https://x/bass.mp3" },
      ] } },
      "split_stem",
      "t",
    )
    expect(r).toEqual({ taskId: "t", bassUrl: "https://x/bass.mp3" })
  })

  it("throws when nothing is mapped", () => {
    expect(() => parseSeparateVocalsResult({ resultObject: { origin_data: [] } }, "separate_vocal", "t")).toThrow(KieError)
    expect(() => parseSeparateVocalsResult({}, "split_stem", "t")).toThrow(KieError)
    expect(() => parseSeparateVocalsResult(null, "split_stem_advanced", "t")).toThrow(KieError)
  })
})

describe("sunoSeparateMarket", () => {
  it("sends audio_url lane body", async () => {
    mockCreateThenRecord(fixture("split_stem_advanced"))
    await withTimers(() =>
      sunoSeparateMarket({ source: { audioUrl: "https://x/a.mp3" }, type: "split_stem_advanced", stemName: "Piano" }),
    )
    expect(createTaskBody()).toEqual({
      model: "ai-music-api/separate-vocals",
      input: { audio_url: "https://x/a.mp3", type: "split_stem_advanced", stem_name: "Piano" },
    })
  })

  it("sends ids lane body", async () => {
    mockCreateThenRecord(fixture("split_stem_advanced"))
    await withTimers(() =>
      sunoSeparateMarket({ source: { taskId: "src-task", audioId: "src-audio" }, type: "split_stem_advanced", stemName: "Lead Vocal" }),
    )
    expect(createTaskBody()).toEqual({
      model: "ai-music-api/separate-vocals",
      input: { task_id: "src-task", audio_id: "src-audio", type: "split_stem_advanced", stem_name: "Lead Vocal" },
    })
  })

  it("sends no stem_name outside one-instrument mode", async () => {
    mockCreateThenRecord(fixture("separate_vocal"))
    await withTimers(() =>
      sunoSeparateMarket({ source: { audioUrl: "https://x/a.mp3" }, type: "separate_vocal", stemName: "Piano" }),
    )
    expect(createTaskBody()).toEqual({
      model: "ai-music-api/separate-vocals",
      input: { audio_url: "https://x/a.mp3", type: "separate_vocal" },
    })
  })

  it("one-instrument mode without a stem name sends the default stem", async () => {
    mockCreateThenRecord(fixture("split_stem_advanced"))
    await withTimers(() =>
      sunoSeparateMarket({ source: { audioUrl: "https://x/a.mp3" }, type: "split_stem_advanced" }),
    )
    expect((createTaskBody().input as Record<string, unknown>).stem_name).toBe("Lead Vocal")
  })

  it("fires onTaskCreated and returns the parsed stems", async () => {
    mockCreateThenRecord(fixture("split_stem"), "t-stems")
    const onTaskCreated = vi.fn(async () => undefined)
    const r = await withTimers(() =>
      sunoSeparateMarket({ source: { audioUrl: "https://x/a.mp3" }, type: "split_stem" }, { onTaskCreated }),
    )
    expect(onTaskCreated).toHaveBeenCalledWith("t-stems")
    expect(r.taskId).toBe("t-stems")
    expect(r.backingVocalsUrl).toMatch(/Backing_Vocals\.mp3$/)
  })

  it("413 → SunoCatalogRefusalError (not a content-policy error)", async () => {
    mockCreateThenRecord(fixture("catalog-refusal"))
    const err = await withTimers(() =>
      sunoSeparateMarket({ source: { audioUrl: "https://x/a.mp3" }, type: "separate_vocal" }),
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SunoCatalogRefusalError)
    expect(err).not.toBeInstanceOf(KieError)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as SunoCatalogRefusalError).code).toBe("suno_catalog_refusal")
    expect((err as Error).message).toBe(SUNO_CATALOG_REFUSAL_MESSAGE)
  })

  it("the catalog wording alone (no 413) is still a catalog refusal", async () => {
    mockCreateThenRecord({
      code: 200,
      data: { taskId: "t", state: "fail", failCode: "500", failMsg: "This audio MATCHES AN EXISTING RECORDING in our catalog." },
    })
    await expect(withTimers(() =>
      sunoSeparateMarket({ source: { audioUrl: "https://x/a.mp3" }, type: "split_stem" }),
    )).rejects.toBeInstanceOf(SunoCatalogRefusalError)
  })

  it("400 retention-period → SunoAudioUnreachableError", async () => {
    mockCreateThenRecord(fixture("unreachable"))
    const err = await withTimers(() =>
      sunoSeparateMarket({ source: { taskId: "src", audioId: "a" }, type: "split_stem_advanced", stemName: "Piano" }),
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SunoAudioUnreachableError)
    expect(err).not.toBeInstanceOf(KieError)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as SunoAudioUnreachableError).code).toBe("suno_audio_unreachable")
    expect((err as Error).message).toBe(SUNO_AUDIO_UNREACHABLE_MESSAGE)
    // KIE's ids never ride on the user-facing error.
    expect((err as Error).message).not.toContain("c0ffee")
  })

  it("any other failure stays the generic upstream failure", async () => {
    mockCreateThenRecord({ code: 200, data: { taskId: "t", state: "fail", failCode: "500", failMsg: "internal error" } })
    const err = await withTimers(() =>
      sunoSeparateMarket({ source: { audioUrl: "https://x/a.mp3" }, type: "separate_vocal" }),
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(KieError)
    expect((err as KieError).isUpstreamFailure).toBe(true)
    expect(isDeterministicJobError(err)).toBe(false)
  })
})

describe("error classes", () => {
  it("default to the exact user copy, and take an optional message", () => {
    expect(new SunoCatalogRefusalError().message).toBe(SUNO_CATALOG_REFUSAL_MESSAGE)
    expect(new SunoCatalogRefusalError(SUNO_CATALOG_REFUSAL_SINGLE_MESSAGE).message).toBe(SUNO_CATALOG_REFUSAL_SINGLE_MESSAGE)
    expect(new SunoAudioUnreachableError().message).toBe(SUNO_AUDIO_UNREACHABLE_MESSAGE)
    expect(new SunoInputTooLargeError().message).toBe(SUNO_INPUT_TOO_LARGE_MESSAGE)
    expect(new SunoInputTooLargeError().code).toBe("suno_input_too_large")
    expect(isDeterministicJobError(new SunoInputTooLargeError())).toBe(true)
    expect(new SunoCatalogRefusalError().name).toBe("SunoCatalogRefusalError")
  })

  it("carry the agreed copy", () => {
    expect(SUNO_CATALOG_REFUSAL_MESSAGE).toBe(
      "Suno recognised this as a commercially released recording and won't separate it. Use the Audio Separation node (Demucs), or turn on 'If Suno refuses, use Demucs'.",
    )
    expect(SUNO_CATALOG_REFUSAL_SINGLE_MESSAGE).toBe(
      "Suno recognised this as a commercially released recording and won't separate it. One-instrument mode has no Demucs fallback — use the Audio Separation node for vocals or stems.",
    )
    expect(SUNO_AUDIO_UNREACHABLE_MESSAGE).toBe(
      "Suno couldn't download this audio. Check the file is reachable, or use the Audio Separation node.",
    )
    expect(SUNO_INPUT_TOO_LARGE_MESSAGE).toBe("Suno accepts audio up to 20 MB — trim it or use Audio Separation.")
  })
})
