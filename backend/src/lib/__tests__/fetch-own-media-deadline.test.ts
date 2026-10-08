import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * A caller's abort signal bounds the WHOLE own-media retry ladder, pauses
 * included. Without that, a caller with a 4 s deadline waited out a 1.5 s or
 * 4 s pause before the next attempt noticed the deadline had passed — 6–8 s on
 * a path a user is waiting on. Real timers are faked here (not the `sleep`
 * seam), so the pause itself is what is under test.
 */

const mocks = vi.hoisted(() => ({ safeFetch: vi.fn() }))
vi.mock("../safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))

const { fetchOwnMedia, OWN_MEDIA_RETRY_DELAYS_MS } = await import("../fetch-own-media.js")
const { sleep } = await import("../sleep.js")

const OWN = "https://cdn.nodaro.test/images/abc.png"
const reply = (status: number) => ({ ok: status >= 200 && status < 300, status, body: { cancel: async () => {} } })

describe("sleep", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("resolves after the delay when nothing aborts it", async () => {
    const ac = new AbortController()
    let done = false
    void sleep(1_000, ac.signal).then(() => { done = true })
    await vi.advanceTimersByTimeAsync(999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })

  it("rejects with the abort reason the moment the signal aborts", async () => {
    const ac = new AbortController()
    const pause = sleep(10_000, ac.signal)
    const settled = pause.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(100)
    ac.abort(new Error("deadline"))
    await expect(settled).resolves.toMatchObject({ message: "deadline" })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("rejects at once for a signal that has already aborted", async () => {
    const ac = new AbortController()
    ac.abort(new Error("already"))
    await expect(sleep(10_000, ac.signal)).rejects.toThrow("already")
    expect(vi.getTimerCount()).toBe(0)
  })

  it("without a signal is the plain delay it always was", async () => {
    let done = false
    void sleep(500).then(() => { done = true })
    await vi.advanceTimersByTimeAsync(500)
    expect(done).toBe(true)
  })
})

describe("fetchOwnMedia — the caller's signal bounds the retry pauses", () => {
  const prevPublic = process.env.R2_PUBLIC_URL

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.safeFetch.mockReset()
    mocks.safeFetch.mockImplementation(async () => reply(404))
    process.env.R2_PUBLIC_URL = "https://cdn.nodaro.test"
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    if (prevPublic === undefined) delete process.env.R2_PUBLIC_URL
    else process.env.R2_PUBLIC_URL = prevPublic
    vi.restoreAllMocks()
  })

  it("an abort during a pause ends the ladder there, without another attempt", async () => {
    const ac = new AbortController()
    const settled = fetchOwnMedia(OWN, { signal: ac.signal }).catch((e: unknown) => e)
    // Attempt 1 (404) → first pause → attempt 2 (404) → into the second pause.
    await vi.advanceTimersByTimeAsync(OWN_MEDIA_RETRY_DELAYS_MS[0]! + 100)
    expect(mocks.safeFetch).toHaveBeenCalledTimes(2)
    ac.abort(new Error("deadline"))
    await expect(settled).resolves.toMatchObject({ message: "deadline" })
    // No third attempt, and no pause left waiting.
    expect(mocks.safeFetch).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("with no signal the ladder still runs to the end", async () => {
    const done = fetchOwnMedia(OWN)
    await vi.advanceTimersByTimeAsync(OWN_MEDIA_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0))
    await expect(done).resolves.toMatchObject({ status: 404 })
    expect(mocks.safeFetch).toHaveBeenCalledTimes(OWN_MEDIA_RETRY_DELAYS_MS.length + 1)
  })
})
