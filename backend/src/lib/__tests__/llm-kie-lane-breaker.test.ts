/**
 * The KIE lane breaker (lib/llm/kie-lane-breaker.ts).
 *
 * Incident 2026-11-16: KIE answered every Claude Sonnet 5.5 request with HTTP
 * 500 for over 16 hours. Every call still asked KIE first, spent the whole
 * retry ladder there and was then served direct. These tests pin the rule
 * that ends that: three KIE-first calls failing in a row, over at least a
 * minute, move a model's calls to the direct lane first, with KIE as the
 * fallback, until one probe call finds KIE answering again.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

vi.mock("../config.js", () => ({
  config: {
    KIE_API_KEY: "test-kie-key",
    GEMINI_API_KEY: "test-gemini-key",
    ANTHROPIC_API_KEY: "",
    NODE_ENV: "test",
  },
}))

const geminiMock = vi.hoisted(() => ({
  callGeminiDirect: vi.fn(),
  streamGeminiDirect: vi.fn(),
}))
vi.mock("../gemini/client.js", () => geminiMock)

import {
  KIE_BREAKER_MIN_SPAN_MS,
  KIE_BREAKER_SKIP_MS,
  KIE_BREAKER_TRIP_FAILURES,
  __resetKieLaneBreaker,
  claimKieLaneRole,
  kieLaneDownFailure,
  kieLaneSkipped,
  noteKieLaneFailure,
  noteKieLaneSuccess,
} from "../llm/kie-lane-breaker.js"
import type { LlmResponse } from "../llm/types.js"
import {
  LlmLaneError,
  LlmOutputTruncatedError,
  LlmPlatformExhaustedError,
  LlmStreamResponseError,
} from "../llm-errors.js"

const MODEL = "gemini-3.6-flash"
const down = () => new LlmLaneError("KIE.ai chat-completions failed (503)", { lane: "kie", httpStatus: 503 })

function kieOk(text = "kie-served"): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )
}
const kieDown = (): Response => new Response("Service Unavailable", { status: 503 })

let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  __resetKieLaneBreaker()
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  warnSpy.mockRestore()
})

describe("which failures say the KIE lane is down", () => {
  it("counts a 5xx (HTTP or in-band code), a timeout and a failed connection", () => {
    expect(kieLaneDownFailure(down())).toBe(true)
    expect(kieLaneDownFailure(new LlmLaneError("code 500", { lane: "kie", bodyCode: 500 }))).toBe(true)
    expect(kieLaneDownFailure(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))).toBe(true)
    expect(kieLaneDownFailure(new TypeError("fetch failed"))).toBe(true)
  })

  it("a timeout under the caller's own deadline is not the lane's", () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })
    expect(kieLaneDownFailure(timeout, false)).toBe(false)
    expect(kieLaneDownFailure(down(), false)).toBe(true)
  })

  it("does not count what is about the request, was billed, or was the caller's own stop", () => {
    // A 4xx: the request was refused.
    expect(kieLaneDownFailure(new LlmLaneError("bad request", { lane: "kie", httpStatus: 400 }))).toBe(false)
    expect(kieLaneDownFailure(new LlmLaneError("unsupported", { lane: "kie", bodyCode: 422 }))).toBe(false)
    // No status: an image that could not be inlined, thrown before any request.
    expect(kieLaneDownFailure(new LlmLaneError("KIE inline image: past the cap", { lane: "kie" }))).toBe(false)
    // The direct lane's failure is not KIE's.
    expect(kieLaneDownFailure(new LlmLaneError("direct 503", { lane: "direct", httpStatus: 503 }))).toBe(false)
    // Reported usage: the provider answered.
    const usage = { inputTokens: 1, outputTokens: 1, providerCost: 0.01, complete: true }
    expect(kieLaneDownFailure(new LlmStreamResponseError("billed", usage, "kie"))).toBe(false)
    expect(kieLaneDownFailure(Object.create(LlmOutputTruncatedError.prototype))).toBe(false)
    // A drained account has its own latch.
    expect(kieLaneDownFailure(Object.create(LlmPlatformExhaustedError.prototype))).toBe(false)
    // A caller's cancel.
    expect(kieLaneDownFailure(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }))).toBe(false)
    expect(kieLaneDownFailure(new Error("socket hang up"))).toBe(false)
    expect(kieLaneDownFailure("boom")).toBe(false)
  })
})

/** Fail `MODEL` on KIE often enough, over a long enough time, to open its breaker at `at`. */
function openAt(at: number): void {
  noteKieLaneFailure(MODEL, "first", down(), { now: at - KIE_BREAKER_MIN_SPAN_MS })
  for (let i = 1; i < KIE_BREAKER_TRIP_FAILURES; i++) noteKieLaneFailure(MODEL, "first", down(), { now: at })
}

describe("opening and closing", () => {
  it("opens at the threshold once the failures span the minimum time, per model", () => {
    const t0 = 1_000_000
    openAt(t0)
    expect(kieLaneSkipped(MODEL)).toBe(true)
    expect(claimKieLaneRole(MODEL, t0)).toBe("fallback")
    expect(claimKieLaneRole(MODEL, t0 + KIE_BREAKER_SKIP_MS - 1)).toBe("fallback")
    expect(kieLaneSkipped("claude-sonnet-5.5")).toBe(false)
    expect(claimKieLaneRole("claude-sonnet-5.5", t0)).toBe("first")
  })

  it("a burst does not open it: many failures inside the minimum span", () => {
    for (let i = 0; i < 20; i++) noteKieLaneFailure(MODEL, "first", down(), { now: 1_000 + i * 100 })
    expect(kieLaneSkipped(MODEL)).toBe(false)
    // Still failing a minute after the first: now it opens.
    noteKieLaneFailure(MODEL, "first", down(), { now: 1_000 + KIE_BREAKER_MIN_SPAN_MS })
    expect(kieLaneSkipped(MODEL)).toBe(true)
  })

  it("fewer failures than the threshold do not open it, however far apart", () => {
    for (let i = 0; i < KIE_BREAKER_TRIP_FAILURES - 1; i++) noteKieLaneFailure(MODEL, "first", down(), { now: i * 10 * KIE_BREAKER_MIN_SPAN_MS })
    expect(kieLaneSkipped(MODEL)).toBe(false)
  })

  it("a success between failures starts the count, and its clock, again", () => {
    noteKieLaneFailure(MODEL, "first", down(), { now: 0 })
    noteKieLaneFailure(MODEL, "first", down(), { now: 1 })
    noteKieLaneSuccess(MODEL)
    const later = 10 * KIE_BREAKER_MIN_SPAN_MS
    for (let i = 0; i < KIE_BREAKER_TRIP_FAILURES; i++) noteKieLaneFailure(MODEL, "first", down(), { now: later + i })
    expect(kieLaneSkipped(MODEL)).toBe(false)
  })

  it("a failure that is not the lane's does not count", () => {
    for (let i = 0; i < 10; i++) {
      noteKieLaneFailure(MODEL, "first", new LlmLaneError("bad request", { lane: "kie", httpStatus: 400 }), { now: i * KIE_BREAKER_MIN_SPAN_MS })
    }
    expect(kieLaneSkipped(MODEL)).toBe(false)
  })

  it("a timeout under the caller's own deadline does not count", () => {
    const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" })
    for (let i = 0; i < 10; i++) noteKieLaneFailure(MODEL, "first", timeout, { now: i * KIE_BREAKER_MIN_SPAN_MS, laneDeadline: false })
    expect(kieLaneSkipped(MODEL)).toBe(false)
  })

  it("after the skip exactly one call is the probe; the others stay on the direct lane", () => {
    openAt(0)
    const after = KIE_BREAKER_SKIP_MS
    expect(claimKieLaneRole(MODEL, after)).toBe("probe")
    expect(claimKieLaneRole(MODEL, after)).toBe("fallback")
    expect(claimKieLaneRole(MODEL, after + 10 * KIE_BREAKER_SKIP_MS)).toBe("fallback")
    expect(kieLaneSkipped(MODEL)).toBe(true)
  })

  it("a probe that finds KIE still down opens it for the same skip again, never longer", () => {
    openAt(0)
    let now = 0
    for (let round = 0; round < 5; round++) {
      now += KIE_BREAKER_SKIP_MS
      expect(claimKieLaneRole(MODEL, now)).toBe("probe")
      noteKieLaneFailure(MODEL, "probe", down(), { now })
      expect(claimKieLaneRole(MODEL, now + KIE_BREAKER_SKIP_MS - 1)).toBe("fallback")
    }
  })

  it("a probe that fails for a reason of its own hands the probe to the next call", () => {
    openAt(0)
    expect(claimKieLaneRole(MODEL, KIE_BREAKER_SKIP_MS)).toBe("probe")
    noteKieLaneFailure(MODEL, "probe", new LlmLaneError("bad request", { lane: "kie", httpStatus: 400 }), { now: KIE_BREAKER_SKIP_MS })
    expect(claimKieLaneRole(MODEL, KIE_BREAKER_SKIP_MS + 1)).toBe("probe")
  })

  it("a probe that is answered closes it", () => {
    openAt(0)
    expect(claimKieLaneRole(MODEL, KIE_BREAKER_SKIP_MS)).toBe("probe")
    noteKieLaneSuccess(MODEL)
    expect(kieLaneSkipped(MODEL)).toBe(false)
    expect(claimKieLaneRole(MODEL, KIE_BREAKER_SKIP_MS)).toBe("first")
  })

  it("KIE failing as the fallback says nothing; KIE answering as the fallback closes it", () => {
    openAt(0)
    for (let i = 0; i < 5; i++) noteKieLaneFailure(MODEL, "fallback", down(), { now: 1_000 })
    expect(claimKieLaneRole(MODEL, KIE_BREAKER_SKIP_MS)).toBe("probe")
    noteKieLaneSuccess(MODEL)
    expect(kieLaneSkipped(MODEL)).toBe(false)
  })

  it("a first-lane failure that lands after another call opened it changes nothing", () => {
    openAt(0)
    noteKieLaneFailure(MODEL, "first", down(), { now: KIE_BREAKER_SKIP_MS + 5 })
    expect(claimKieLaneRole(MODEL, KIE_BREAKER_SKIP_MS + 5)).toBe("probe")
  })
})

describe("a KIE-first call while the model's breaker is open", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const ask = async (extra: Record<string, unknown> = {}) => {
    const { llmComplete } = await import("../llm-client.js")
    return llmComplete({ modelId: MODEL, system: "", messages: [{ role: "user", content: "hi" }], ...extra })
  }
  const direct = { text: "direct-served", usage: { inputTokens: 1, outputTokens: 1 }, model: MODEL }

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    geminiMock.callGeminiDirect.mockReset()
    geminiMock.streamGeminiDirect.mockReset()
    vi.useFakeTimers({ toFake: ["Date"] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** KIE fails every call until the model's breaker opens; the direct lane serves each of them. */
  async function failUntilOpen(): Promise<void> {
    fetchMock.mockImplementation(async () => kieDown())
    geminiMock.callGeminiDirect.mockResolvedValue(direct)
    expect((await ask()).text).toBe("direct-served")
    vi.setSystemTime(Date.now() + KIE_BREAKER_MIN_SPAN_MS)
    for (let i = 1; i < KIE_BREAKER_TRIP_FAILURES; i++) expect((await ask()).text).toBe("direct-served")
    expect(fetchMock).toHaveBeenCalledTimes(KIE_BREAKER_TRIP_FAILURES)
    fetchMock.mockClear()
    geminiMock.callGeminiDirect.mockClear()
  }

  it("a burst of failures leaves the model on KIE first", async () => {
    fetchMock.mockImplementation(async () => kieDown())
    geminiMock.callGeminiDirect.mockResolvedValue(direct)
    for (let i = 0; i < 6; i++) expect((await ask()).text).toBe("direct-served")
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it("is served by the direct lane without asking KIE, then one probe puts it back on KIE", async () => {
    await failUntilOpen()

    expect((await ask()).text).toBe("direct-served")
    expect((await ask()).text).toBe("direct-served")
    expect(fetchMock).not.toHaveBeenCalled()
    expect(geminiMock.callGeminiDirect).toHaveBeenCalledTimes(2)

    // The skip is over and KIE answers again: back to KIE first.
    vi.setSystemTime(Date.now() + KIE_BREAKER_SKIP_MS)
    fetchMock.mockImplementation(async () => kieOk())
    expect((await ask()).text).toBe("kie-served")
    expect((await ask()).text).toBe("kie-served")
    expect(geminiMock.callGeminiDirect).toHaveBeenCalledTimes(2)
  })

  it("while the probe is in flight every other call stays on the direct lane", async () => {
    await failUntilOpen()
    vi.setSystemTime(Date.now() + KIE_BREAKER_SKIP_MS)
    let answerKie!: (r: Response) => void
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { answerKie = resolve }))

    const probe = ask()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect((await ask()).text).toBe("direct-served")
    expect((await ask()).text).toBe("direct-served")
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // KIE is still down: the probe's caller is served direct, and the skip starts again.
    answerKie(kieDown())
    expect((await probe).text).toBe("direct-served")
    expect((await ask()).text).toBe("direct-served")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("the probe is sent with transport retries off; any other call keeps the caller's setting", async () => {
    const { withDirectFallback } = await import("../llm/lane-fallback.js")
    const ctx = { modelId: MODEL, primary: "kie", fallback: "direct-gemini" }
    const req = { modelId: MODEL, system: "", messages: [{ role: "user" as const, content: "hi" }] }
    const sent: Array<boolean | undefined> = []
    const kie = vi.fn(async (r: { retryStreamOnError?: boolean }) => {
      sent.push(r.retryStreamOnError)
      throw down()
    })
    const viaDirect = vi.fn(async () => direct as unknown as LlmResponse)

    await withDirectFallback(ctx, req, kie, viaDirect)
    vi.setSystemTime(Date.now() + KIE_BREAKER_MIN_SPAN_MS)
    for (let i = 1; i < KIE_BREAKER_TRIP_FAILURES; i++) await withDirectFallback(ctx, req, kie, viaDirect)
    expect(sent).toEqual([undefined, undefined, undefined])

    vi.setSystemTime(Date.now() + KIE_BREAKER_SKIP_MS)
    await withDirectFallback(ctx, req, kie, viaDirect)
    expect(sent).toEqual([undefined, undefined, undefined, false])
  })

  it("the provider a call is counted against follows the breaker", async () => {
    const { laneForCallNow } = await import("../llm/router.js")
    const { getLlmModel } = await import("@nodaro/shared/llm-models")
    const model = getLlmModel(MODEL)!
    const req = { modelId: MODEL, system: "", messages: [{ role: "user" as const, content: "hi" }] }
    expect(laneForCallNow(model, req)).toBe("kie")
    await failUntilOpen()
    expect(laneForCallNow(model, req)).toBe("google")
    expect(laneForCallNow(model, { ...req, cheapLanesOnly: true })).toBe("kie")
    expect(laneForCallNow(model, { ...req, requireLane: "kie" })).toBe("kie")
  })

  it("falls back to KIE when the direct lane fails", async () => {
    await failUntilOpen()
    geminiMock.callGeminiDirect.mockRejectedValue(new Error("got status: 503 UNAVAILABLE"))
    fetchMock.mockImplementation(async () => kieOk())

    expect((await ask()).text).toBe("kie-served")
    const line = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).find((l: string) => l.includes("[llm-lane-fallback]") && l.includes("direct-gemini lane failed"))
    expect(line).toContain("serving from kie")
    // KIE answered, so the next call starts there again.
    geminiMock.callGeminiDirect.mockClear()
    expect((await ask()).text).toBe("kie-served")
    expect(geminiMock.callGeminiDirect).not.toHaveBeenCalled()
  })

  it("a run kept to the cheap lanes keeps asking KIE and is never moved to the direct lane", async () => {
    await failUntilOpen()
    fetchMock.mockImplementation(async () => kieDown())

    await expect(ask({ cheapLanesOnly: true })).rejects.toBeInstanceOf(LlmLaneError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(geminiMock.callGeminiDirect).not.toHaveBeenCalled()
  })

  it("a KIE-pinned call is never moved either", async () => {
    await failUntilOpen()
    fetchMock.mockImplementation(async () => kieOk())

    expect((await ask({ requireLane: "kie" })).text).toBe("kie-served")
    expect(geminiMock.callGeminiDirect).not.toHaveBeenCalled()
  })

  it("a stream starts on the direct lane too", async () => {
    await failUntilOpen()
    geminiMock.streamGeminiDirect.mockImplementation(async (_m: unknown, _r: unknown, _p: unknown, onToken: (c: string) => void) => {
      onToken("direct-")
      onToken("served")
      return direct
    })
    const { llmStream } = await import("../llm-client.js")
    const chunks: string[] = []
    const res = await llmStream({ modelId: MODEL, system: "", messages: [{ role: "user", content: "hi" }] }, (c) => chunks.push(c))

    expect(res.text).toBe("direct-served")
    expect(chunks.join("")).toBe("direct-served")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("says so once when it opens and once when KIE answers again", async () => {
    await failUntilOpen()
    const lines = () => warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes("[llm-kie-breaker]"))
    expect(lines()).toEqual([`[llm-kie-breaker] ${MODEL}: 3 KIE-first calls failed in a row — calls start on the direct lane for 2 min`])

    vi.setSystemTime(Date.now() + KIE_BREAKER_SKIP_MS)
    fetchMock.mockImplementation(async () => kieOk())
    await ask()
    expect(lines()).toHaveLength(2)
    expect(lines()[1]).toBe(`[llm-kie-breaker] ${MODEL}: KIE answered — calls start on KIE again`)
  })
})
