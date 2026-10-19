import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}))

import { continueUseCase, estimateUseCase, runUseCase } from "../api"
import { useLocaleStore } from "@/lib/locale-store"
import type { LocaleId } from "@nodaro/shared/i18n"

/**
 * The use-case client on Tighten Episode: the run and the continue each carry
 * the call's Idempotency-Key (the server hands a keyed retry its run back, one
 * run and one fee), each posts its own type's route, and the continue keeps
 * the job a 409 names beside `error`.
 */
function mockFetch(status: number, data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

const headersOf = (f: ReturnType<typeof mockFetch>) => (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>
const bodyOf = (f: ReturnType<typeof mockFetch>) => JSON.parse((f.mock.calls[0][1] as RequestInit).body as string) as Record<string, unknown>

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "token" } } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  useLocaleStore.setState({ locale: "en" })
})

describe("runUseCase", () => {
  it("sends the recording as mediaUrls and the call's Idempotency-Key", async () => {
    const f = mockFetch(202, { jobId: "job-1" })
    vi.stubGlobal("fetch", f)
    await expect(runUseCase("tighten-episode", { mediaUrls: ["https://r2/ep.mp4"], settings: { captions: false } }, "click-1:iter:2")).resolves.toEqual({ jobId: "job-1" })
    expect(headersOf(f)["Idempotency-Key"]).toBe("click-1:iter:2")
    expect(bodyOf(f)).toMatchObject({ mediaUrls: ["https://r2/ep.mp4"], captions: false })
  })

  it("sends no key when the call has none", async () => {
    const f = mockFetch(202, { jobId: "job-1" })
    vi.stubGlobal("fetch", f)
    await runUseCase("tighten-episode", { mediaUrls: ["https://r2/ep.mp4"], settings: {} })
    expect(headersOf(f)["Idempotency-Key"]).toBeUndefined()
  })

  it("runUseCase posts the type's route with the recording, the optional inputs and the settings", async () => {
    const f = mockFetch(202, { jobId: "job-1" })
    vi.stubGlobal("fetch", f)
    await runUseCase("tighten-episode", { mediaUrls: ["https://r2/ep.mp4"], musicUrl: "https://r2/bed.mp3", settings: { captions: false } }, "k-1234567890123456")
    expect(f).toHaveBeenCalledWith(expect.stringContaining("/v1/tighten-episode"), expect.objectContaining({ method: "POST" }))
    expect(bodyOf(f)).toMatchObject({ mediaUrls: ["https://r2/ep.mp4"], musicUrl: "https://r2/bed.mp3", captions: false })
  })

  it("drops an unset setting, and keeps an empty one and a null one (the run decides which to send)", async () => {
    const f = mockFetch(202, { jobId: "job-1" })
    vi.stubGlobal("fetch", f)
    await runUseCase("tighten-episode", { mediaUrls: ["https://r2/ep.mp4"], settings: { output: undefined, framing: null, instructions: "", captions: true } })
    expect((f.mock.calls[0][1] as RequestInit).body).toBe(JSON.stringify({ mediaUrls: ["https://r2/ep.mp4"], framing: null, instructions: "", captions: true }))
  })
})

describe("estimateUseCase", () => {
  it("posts the type's estimate route and answers its figures", async () => {
    const data = { totalCredits: 31, stepsCredits: 21, feeCredits: 10, durationSec: 600 }
    const f = mockFetch(200, { data })
    vi.stubGlobal("fetch", f)
    await expect(estimateUseCase("tighten-episode", { mediaUrls: ["https://r2/ep.mp4"], settings: { captions: false } })).resolves.toEqual(data)
    expect(f.mock.calls[0][0]).toMatch(/\/v1\/tighten-episode\/estimate$/)
    expect(bodyOf(f)).toMatchObject({ mediaUrls: ["https://r2/ep.mp4"], captions: false })
  })
})

/**
 * A refused start or estimate names the node in the reader's language: the
 * very sentences Tighten Episode's own keys said before the client served
 * every use-case node.
 */
describe("a refused start or estimate names the node in each locale", () => {
  const CASES: ReadonlyArray<readonly [LocaleId, string, string]> = [
    ["en", "Couldn't start Tighten Episode", "Couldn't estimate Tighten Episode"],
    ["he", "לא ניתן להפעיל את הידוק פרק", "לא ניתן להעריך את הידוק פרק"],
    ["ja", "「エピソードを引き締める」を開始できませんでした", "「エピソードを引き締める」の見積もりができませんでした"],
    ["ko", "“에피소드 다듬기”를 시작하지 못했습니다", "“에피소드 다듬기”의 예상 비용을 계산하지 못했습니다"],
    ["pt-BR", "Não foi possível iniciar o Enxugar episódio", "Não foi possível estimar o Enxugar episódio"],
  ]
  for (const [locale, start, estimate] of CASES) {
    it(locale, async () => {
      useLocaleStore.setState({ locale })
      vi.stubGlobal("fetch", mockFetch(500, null))
      await expect(runUseCase("tighten-episode", { mediaUrls: ["https://r2/ep.mp4"], settings: {} })).rejects.toThrow(new Error(start))
      vi.stubGlobal("fetch", mockFetch(500, null))
      await expect(estimateUseCase("tighten-episode", { mediaUrls: ["https://r2/ep.mp4"], settings: {} })).rejects.toThrow(new Error(estimate))
    })
  }
})

describe("continueUseCase", () => {
  it("continueUseCase posts the run's own type's continue route", async () => {
    const f = mockFetch(202, { jobId: "job-2" })
    vi.stubGlobal("fetch", f)
    await continueUseCase({ nodeType: "tighten-episode", jobId: "00000000-0000-4000-8000-000000000009", mode: "from-failed" })
    expect(f.mock.calls[0]![0]).toMatch(/\/v1\/tighten-episode\/continue$/)
    // The type picks the route; it is never sent.
    expect(bodyOf(f)).not.toHaveProperty("nodeType")
  })

  it("sends the Idempotency-Key and the node, and answers started", async () => {
    const f = mockFetch(202, { jobId: "job-2", executionId: "exec-2" })
    vi.stubGlobal("fetch", f)
    await expect(continueUseCase({ nodeType: "tighten-episode", jobId: "00000000-0000-4000-8000-000000000000", mode: "from-failed", nodeId: "t1" }, "click-2")).resolves.toEqual({ kind: "started", jobId: "job-2" })
    expect(headersOf(f)["Idempotency-Key"]).toBe("click-2")
    expect(bodyOf(f)).toMatchObject({ mode: "from-failed", nodeId: "t1" })
  })

  it("keeps the job a 409 names: already running, superseded; and reads settling", async () => {
    vi.stubGlobal("fetch", mockFetch(409, { error: { code: "already_running", message: "under way" }, jobId: "job-live" }))
    await expect(continueUseCase({ nodeType: "tighten-episode", jobId: "j", mode: "from-failed" })).resolves.toEqual({ kind: "running", jobId: "job-live" })
    // A Render final refused (a final under way, or this very edit already rendered) fails, naming that final.
    for (const code of ["render_final_already_rendered", "already_running"]) {
      vi.stubGlobal("fetch", mockFetch(409, { error: { code, message: "refused" }, jobId: "job-f" }))
      await expect(continueUseCase({ nodeType: "tighten-episode", jobId: "j", mode: "render-final" })).rejects.toMatchObject({ code, jobId: "job-f" })
    }
    vi.stubGlobal("fetch", mockFetch(409, { error: { code: "continuation_superseded", message: "newer" }, jobId: "job-new" }))
    await expect(continueUseCase({ nodeType: "tighten-episode", jobId: "j", mode: "from-failed" })).resolves.toEqual({ kind: "superseded", jobId: "job-new", message: "newer" })
    vi.stubGlobal("fetch", mockFetch(409, { error: { code: "continuation_settling", message: "wait" } }))
    await expect(continueUseCase({ nodeType: "tighten-episode", jobId: "j", mode: "from-failed" })).resolves.toEqual({ kind: "settling", message: "wait" })
  })

  it("throws any other refusal with its code", async () => {
    vi.stubGlobal("fetch", mockFetch(409, { error: { code: "continuation_not_failed", message: "did not fail" } }))
    await expect(continueUseCase({ nodeType: "tighten-episode", jobId: "j", mode: "from-failed" })).rejects.toMatchObject({ code: "continuation_not_failed" })
  })
})
