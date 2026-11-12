import { beforeEach, describe, expect, it, vi } from "vitest"

const fetchMock = vi.hoisted(() => ({ safeFetch: vi.fn() }))
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: fetchMock.safeFetch }))

const kie = vi.hoisted(() => ({ runKieTask: vi.fn(), sleep: vi.fn(async (_ms: number) => {}) }))
vi.mock("../client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client.js")>()),
  runKieTask: kie.runKieTask,
  // The result file's backoff waits on the client's drain-aware sleep: recorded, not waited.
  sleep: kie.sleep,
}))

import { NEMOTRON_TRANSCRIBE_ID } from "@nodaro/shared/credits"
import {
  NEMOTRON_KIE_MODEL,
  buildNemotronTranscribeInput,
  nemotronOutputFromResult,
  runNemotronTranscribe,
} from "../nemotron-transcribe.js"

const RESULT_URL = "https://tempfile.aiquickdraw.com/js/y1/task.json"

function fileResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.safeFetch.mockReset()
})

describe("buildNemotronTranscribeInput — the allow-listed body", () => {
  it("a plain transcript sends the file alone (never `language`: the model detects it)", () => {
    expect(buildNemotronTranscribeInput({ audioUrl: "https://x/a.mp3" })).toEqual({ audio_url: "https://x/a.mp3" })
  })

  it("word timings send `timestamps: true`; a translation sends `target_language`", () => {
    expect(buildNemotronTranscribeInput({ audioUrl: "https://x/a.mp3", wordTimestamps: true })).toEqual({ audio_url: "https://x/a.mp3", timestamps: true })
    expect(buildNemotronTranscribeInput({ audioUrl: "https://x/a.mp3", targetLanguage: "en" })).toEqual({ audio_url: "https://x/a.mp3", target_language: "en" })
  })

  it("never sends the pair KIE refuses", () => {
    expect(() => buildNemotronTranscribeInput({ audioUrl: "https://x/a.mp3", wordTimestamps: true, targetLanguage: "en" })).toThrow(/word timings/)
  })
})

describe("nemotronOutputFromResult", () => {
  it("reads the result file for the words and records KIE's cost from the decoded length", async () => {
    fetchMock.safeFetch.mockResolvedValue(fileResponse({
      duration: 120,
      text: "Hi there.",
      words: [{ word: "Hi", start: 0, end: 0.3, speaker: "0" }, { word: "there.", start: 0.3, end: 0.8, speaker: "0" }],
    }))
    const out = await nemotronOutputFromResult({ resultObject: { text: "Hi there.", duration: 120, url: RESULT_URL } }, { wordTimestamps: true })
    expect(fetchMock.safeFetch).toHaveBeenCalledWith(RESULT_URL, expect.anything())
    expect(out.words).toHaveLength(2)
    expect(out.cost).toBe(0.003)
  })

  it("retries an unreadable result file with a backoff (1 s, 3 s, 9 s), then falls back to the resultObject for a plain transcript", async () => {
    fetchMock.safeFetch.mockResolvedValue(fileResponse({}, 503))
    const out = await nemotronOutputFromResult({ resultObject: { text: "Hi.", duration: 30, url: RESULT_URL, truncated: true } }, {})
    expect(fetchMock.safeFetch).toHaveBeenCalledTimes(4)
    expect(kie.sleep.mock.calls.map((c) => c[0])).toEqual([1_000, 3_000, 9_000])
    expect(out.text).toBe("Hi.")
    expect(out.truncated).toBe(true)
    expect(out.cost).toBe(0.00075)
  })

  it("a file read on a retry is used, with no further waits", async () => {
    fetchMock.safeFetch.mockResolvedValueOnce(fileResponse({}, 502)).mockResolvedValueOnce(fileResponse({ text: "From the file.", duration: 30 }))
    const out = await nemotronOutputFromResult({ resultObject: { text: "Hi.", duration: 30, url: RESULT_URL } }, {})
    expect(out.text).toBe("From the file.")
    expect(kie.sleep.mock.calls.map((c) => c[0])).toEqual([1_000])
  })

  it("word timings asked and the file never read: fails (to refund), after the retries", async () => {
    fetchMock.safeFetch.mockRejectedValue(new Error("ECONNRESET"))
    await expect(nemotronOutputFromResult({ resultObject: { text: "Hi.", duration: 30, url: RESULT_URL } }, { wordTimestamps: true })).rejects.toThrow(/word timestamps/)
    expect(fetchMock.safeFetch).toHaveBeenCalledTimes(4)
  })

  it("records KIE's own billed figure when the task record carries one", async () => {
    fetchMock.safeFetch.mockResolvedValue(fileResponse({ text: "Hi.", duration: 47 }))
    const out = await nemotronOutputFromResult({ resultObject: { text: "Hi.", duration: 47, url: RESULT_URL } }, { kieCredits: 0.24 })
    expect(out.cost).toBe(0.0012)
    expect(out.kieCredits).toBe(0.24)
  })

  it("uses the measured length for the cost when KIE reports none", async () => {
    fetchMock.safeFetch.mockResolvedValue(fileResponse({ text: "Hi." }))
    const out = await nemotronOutputFromResult({ resultObject: { text: "Hi.", url: RESULT_URL } }, { fallbackDurationSec: 60 })
    expect(out.cost).toBe(0.0015)
  })

  it("never fetches a result address that is not https", async () => {
    const out = await nemotronOutputFromResult({ resultObject: { text: "Hi.", duration: 10, url: "http://insecure/x.json" } }, {})
    expect(fetchMock.safeFetch).not.toHaveBeenCalled()
    expect(out.text).toBe("Hi.")
  })

  it("a finished task with no resultObject is an error, not an empty transcript", async () => {
    await expect(nemotronOutputFromResult({ resultUrls: [] }, {})).rejects.toThrow()
  })
})

describe("runNemotronTranscribe", () => {
  it("runs KIE's model with the allow-listed body and saves the task id for the reconcile", async () => {
    kie.runKieTask.mockResolvedValue({ resultJson: { resultObject: { text: "Hola.", duration: 6, url: RESULT_URL, target_language: "en" } } })
    fetchMock.safeFetch.mockResolvedValue(fileResponse({ task: "translate", text: "Hello.", duration: 6 }))
    const onTaskCreated = vi.fn()
    const out = await runNemotronTranscribe({ audioUrl: "https://x/es.mp3", targetLanguage: "en" }, { onTaskCreated })
    expect(kie.runKieTask).toHaveBeenCalledWith(
      NEMOTRON_KIE_MODEL,
      { audio_url: "https://x/es.mp3", target_language: "en" },
      expect.any(Number),
      undefined,
      expect.objectContaining({ onTaskCreated, modelKey: NEMOTRON_TRANSCRIBE_ID }),
    )
    expect(out).toMatchObject({ text: "Hello.", language: "en", cost: 0.00015 })
  })
})

describe("runNemotronTranscribe — the billing dimension", () => {
  it("hands the measured length to the egress seam (KIE bills by the second)", async () => {
    kie.runKieTask.mockResolvedValue({ resultJson: { resultObject: { text: "Hi.", duration: 125, url: RESULT_URL } } })
    fetchMock.safeFetch.mockResolvedValue(fileResponse({ text: "Hi.", duration: 125 }))
    await runNemotronTranscribe({ audioUrl: "https://x/a.mp3", fallbackDurationSec: 125 })
    expect(kie.runKieTask.mock.calls[0]![4]).toMatchObject({ dimensions: { duration: 125, durationLabel: "125s" } })
  })
})

describe("runNemotronTranscribe — what KIE billed", () => {
  it("takes provider_cost from the task record's creditsConsumed (KIE's own figure)", async () => {
    kie.runKieTask.mockResolvedValue({
      resultJson: { resultObject: { text: "Hi.", duration: 47, url: RESULT_URL } },
      rawRecordInfo: { data: { creditsConsumed: 0.24 } },
    })
    fetchMock.safeFetch.mockResolvedValue(fileResponse({ text: "Hi.", duration: 47 }))
    const out = await runNemotronTranscribe({ audioUrl: "https://x/a.mp3" })
    expect(out.cost).toBe(0.0012)
    expect(out.durationSec).toBe(47)
    // Handed on to the settle: the length to charge on when KIE reports no duration.
    expect(out.kieCredits).toBe(0.24)
  })
})

describe("the KIE audio provider's transcription capability", () => {
  it("never offers Nemotron: its speechToText runs Scribe, so a capability lookup could bill Nemotron and run Scribe", async () => {
    const { registerKieProviders } = await import("../index.js")
    const { providerRegistry } = await import("../../registry.js")
    registerKieProviders()
    expect(providerRegistry.supportsModel("kie", "transcription", "elevenlabs-stt")).toBe(true)
    expect(providerRegistry.supportsModel("kie", "transcription", NEMOTRON_TRANSCRIBE_ID)).toBe(false)
  })
})
