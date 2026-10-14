import { UGC_NOT_SERVED_MESSAGE } from "@nodaro/shared/ugc"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }) }))

import {
  InsufficientCreditsError,
  StorageExceededError,
  UgcApiError,
  UgcInsufficientCreditsError,
  startUgcChildJob,
  ugcCardsApi,
  ugcCategoriesApi,
  ugcClipApi,
  ugcClipsApi,
  ugcCreatorApi,
  ugcEstimateApi,
  ugcQuoteApi,
  ugcScriptApi,
} from "../api"

const answer = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }))
afterEach(() => vi.unstubAllGlobals())

describe("the UGC api functions keep the HTTP status", () => {
  it("Fastify's default 404 body → UgcApiError(404) with the Cloud sentence", async () => {
    vi.stubGlobal("fetch", answer(404, { message: "Route POST:/v1/ugc/script not found", error: "Not Found", statusCode: 404 }))
    const err = await ugcScriptApi({ site: "Acme", screenshots: [], targetDurationSec: 15, language: "en" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UgcApiError)
    expect((err as UgcApiError).status).toBe(404)
    expect((err as Error).message).toBe(UGC_NOT_SERVED_MESSAGE)
  })
  it("a bodyless GET 404 (no JSON at all) is the same sentence", async () => {
    vi.stubGlobal("fetch", answer(404, "Not Found"))
    await expect(ugcCategoriesApi()).rejects.toThrow(UGC_NOT_SERVED_MESSAGE)
  })
  it("a 422 minor_age_refused reads as the app's adult-only sentence", async () => {
    vi.stubGlobal("fetch", answer(422, { error: { code: "minor_age_refused", message: "Creator age must be an adult age (20 or older)." } }))
    await expect(ugcCreatorApi({ source: { kind: "sampled", gender: "woman" } })).rejects.toThrow("That age can't be used: UGC creators are adults only.")
  })
  it("a 402 insufficient_credits keeps the typed error the buy-credits dialog listens for", async () => {
    vi.stubGlobal("fetch", answer(402, { error: { code: "insufficient_credits", message: "Not enough credits." } }))
    await expect(ugcScriptApi({ site: "Acme", screenshots: [], targetDurationSec: 15, language: "en" })).rejects.toBeInstanceOf(InsufficientCreditsError)
  })
})

describe("the UGC 402: the dialog's numbers only when the route names both", () => {
  it("a 402 naming required and balance is a UgcInsufficientCreditsError carrying them, still an InsufficientCreditsError", async () => {
    vi.stubGlobal("fetch", answer(402, { error: { code: "insufficient_credits", message: "Not enough credits." }, required: 18, balance: 5 }))
    const err = await startUgcChildJob("/v1/generate-image", { prompt: "p" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UgcInsufficientCreditsError)
    expect(err).toBeInstanceOf(InsufficientCreditsError)
    expect(err).toMatchObject({ required: 18, balance: 5, code: "insufficient_credits", message: "Not enough credits." })
  })
  it("a 402 naming required but withholding balance (a deployment payer) is a plain InsufficientCreditsError", async () => {
    vi.stubGlobal("fetch", answer(402, { error: { code: "insufficient_credits", message: "Not enough credits." }, required: 18 }))
    const err = await startUgcChildJob("/v1/generate-image", { prompt: "p" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(InsufficientCreditsError)
    expect(err).not.toBeInstanceOf(UgcInsufficientCreditsError)
  })
  it("another refusal that means the run cannot pay keeps its code (the round's spend list reads it)", async () => {
    vi.stubGlobal("fetch", answer(402, { error: { code: "budget_exceeded", message: "This workspace has spent its budget." } }))
    const err = await startUgcChildJob("/v1/image-to-text/describe", { imageUrl: "https://cdn.example/a.png" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UgcApiError)
    expect(err).toMatchObject({ status: 402, code: "budget_exceeded", message: "This workspace has spent its budget." })
  })
  it("storage refusals keep their typed error", async () => {
    vi.stubGlobal("fetch", answer(413, { error: { code: "storage_limit_exceeded", message: "Storage full.", usedBytes: 9, quotaBytes: 10, tier: "pro" } }))
    await expect(startUgcChildJob("/v1/generate-image", { prompt: "p" })).rejects.toBeInstanceOf(StorageExceededError)
  })
  it("a 500 never shows its internal text", async () => {
    vi.stubGlobal("fetch", answer(500, { error: { code: "internal", message: "stack trace here" } }))
    const err = await ugcClipsApi({ plan: {} }).catch((e: unknown) => e)
    expect((err as Error).message).toBe("UGC step failed (500)")
    expect((err as UgcApiError).code).toBe("internal")
  })
})

describe("the UGC calls: route, method, body and key", () => {
  const ok = (body: unknown) => answer(200, body)
  const sent = (fetchMock: ReturnType<typeof vi.fn>) => {
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body?: string }]
    return { url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) }
  }
  it.each([
    ["ugcCreatorApi", () => ugcCreatorApi({ source: { kind: "photo" } }, { idempotencyKey: "key-123456" }), "/v1/ugc/creator"],
    ["ugcScriptApi", () => ugcScriptApi({ site: "Acme" }, { idempotencyKey: "key-123456" }), "/v1/ugc/script"],
    ["ugcClipsApi", () => ugcClipsApi({ plan: {} }, { idempotencyKey: "key-123456" }), "/v1/ugc/clips"],
    ["ugcClipApi", () => ugcClipApi({ ticket: {} }, { idempotencyKey: "key-123456" }), "/v1/ugc/clip"],
    ["ugcCardsApi", () => ugcCardsApi({ surface: "canvas" }, { idempotencyKey: "key-123456" }), "/v1/ugc/cards"],
    ["startUgcChildJob", () => startUgcChildJob("/v1/forced-alignment", { audioUrl: "https://cdn.example/v.mp4" }, { idempotencyKey: "key-123456" }), "/v1/forced-alignment"],
  ] as const)("%s posts JSON to its route with the call's key", async (_name, call, path) => {
    const fetchMock = ok({ jobId: "j" })
    vi.stubGlobal("fetch", fetchMock)
    await call()
    const s = sent(fetchMock)
    expect(s.url).toBe(path)
    expect(s.method).toBe("POST")
    expect(s.headers).toMatchObject({ "Content-Type": "application/json", Authorization: "Bearer t", "Idempotency-Key": "key-123456" })
    expect(s.body).toBeTypeOf("object")
  })
  it("without a key, no Idempotency-Key header", async () => {
    const fetchMock = ok({ jobId: "j" })
    vi.stubGlobal("fetch", fetchMock)
    await ugcScriptApi({ site: "Acme" })
    expect(sent(fetchMock).headers).not.toHaveProperty("Idempotency-Key")
  })
  it("the categories are a bodyless GET; the quote posts tickets and hasCards", async () => {
    const get = ok({ categories: [] })
    vi.stubGlobal("fetch", get)
    await expect(ugcCategoriesApi()).resolves.toEqual({ categories: [] })
    expect(sent(get)).toMatchObject({ url: "/v1/ugc/categories", method: "GET", body: undefined })
    expect(sent(get).headers).not.toHaveProperty("Content-Type")
    const quote = ok({ lines: [], expected: 1, ceiling: 2 })
    vi.stubGlobal("fetch", quote)
    await expect(ugcQuoteApi({ tickets: [{ v: 1 }], hasCards: true })).resolves.toEqual({ lines: [], expected: 1, ceiling: 2 })
    expect(sent(quote)).toMatchObject({ url: "/v1/ugc/quote", method: "POST", body: { tickets: [{ v: 1 }], hasCards: true } })
    expect(sent(quote).body).not.toHaveProperty("finishes")
    // Clips that go through UGC Finish's job: the quote is told, so it prices the finish.
    const finished = ok({ lines: [], expected: 1, ceiling: 2 })
    vi.stubGlobal("fetch", finished)
    await ugcQuoteApi({ tickets: [{ v: 1 }], hasCards: true, finishes: true })
    expect(sent(finished).body).toEqual({ tickets: [{ v: 1 }], hasCards: true, finishes: true })
  })
  it("the estimate posts the graph's inputs under `estimate`, with no workflow id, and hands the call its signal", async () => {
    const answerBody = { lines: [], expected: 10, ceiling: 20, range: [8, 12], worstCase: 24, parts: { script: 10 } }
    const est = ok(answerBody)
    vi.stubGlobal("fetch", est)
    const controller = new AbortController()
    const request = { targetDurationSec: 15, screenshotCount: 3, source: "sampled", rendersEveryCandidate: true } as const
    await expect(ugcEstimateApi(request, { signal: controller.signal })).resolves.toEqual(answerBody)
    expect(sent(est)).toMatchObject({ url: "/v1/ugc/quote", method: "POST", body: { estimate: request } })
    expect(sent(est).body).not.toHaveProperty("workflowId")
    expect((est.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(controller.signal)
  })
  it("a call with no signal sends none", async () => {
    const quote = ok({ lines: [], expected: 1, ceiling: 2 })
    vi.stubGlobal("fetch", quote)
    await ugcQuoteApi({ tickets: [{ v: 1 }], hasCards: true })
    expect((quote.mock.calls[0] as unknown as [string, RequestInit])[1]).not.toHaveProperty("signal")
  })
  it("an estimate this deployment cannot serve fails with the Cloud sentence, like every UGC call", async () => {
    vi.stubGlobal("fetch", answer(503, { error: { code: "not_available", message: UGC_NOT_SERVED_MESSAGE } }))
    await expect(ugcEstimateApi({ targetDurationSec: 15, screenshotCount: 0, source: "photo" })).rejects.toBeInstanceOf(UgcApiError)
  })
  it("a 200 that is not JSON fails plainly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html>", { status: 200 })))
    await expect(ugcScriptApi({ site: "Acme" })).rejects.toThrow()
  })
})

describe("a UGC answer sets the editor's reading of the server's clock", () => {
  it("its Date header: a result the editor stamps after it is read on the server's clock", async () => {
    const { resetServerClock, serverNowIso } = await import("../server-clock")
    resetServerClock()
    const browserNow = Date.parse("2026-10-05T10:02:00.500Z")
    vi.spyOn(Date, "now").mockReturnValue(browserNow)
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errors: [], tickets: [] }), { status: 200, headers: { "Content-Type": "application/json", Date: "Mon, 05 Oct 2026 10:00:00 GMT" } })))
      await ugcClipsApi({ planWire: "{}" })
      expect(serverNowIso(browserNow)).toBe("2026-10-05T10:00:00.500Z")
    } finally {
      vi.restoreAllMocks()
      resetServerClock()
    }
  })
})
