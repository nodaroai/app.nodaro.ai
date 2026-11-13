import { describe, it, expect, afterEach, vi } from "vitest"
import {
  isNodeUnavailable,
  isModelUnavailable,
  isNodeHiddenFromUsers,
  isWebScrapeSourceUnavailable,
  isWebScrapeSourceHiddenFromUsers,
  loadSurfaceAvailability,
  resetSurfaceAvailability,
  subscribeSurfaceAvailability,
  surfaceAvailabilityFailed,
  surfaceAvailabilityLoaded,
  __resetSurfaceAvailabilityForTests,
} from "../surface-availability"

afterEach(() => {
  __resetSurfaceAvailabilityForTests(null)
  delete window.__NODARO_RUNTIME__
})

describe("surface-availability — fetched effective set with static-profile fallback", () => {
  it("pre-fetch: falls back to the static profile's explicit deny only", () => {
    window.__NODARO_RUNTIME__ = { surface: { nodes: { deny: ["suno-generate"], allow: ["generate-image"] } } }
    expect(isNodeUnavailable("suno-generate")).toBe(true)
    // allow-inversion is deliberately NOT applied client-side pre-fetch — the
    // gateable-universe scoping lives backend-side; a brief over-show is
    // harmless because the backend refuses at write/run.
    expect(isNodeUnavailable("generate-video")).toBe(false)
  })

  it("post-fetch: the fetched effective set replaces the fallback entirely", () => {
    window.__NODARO_RUNTIME__ = { surface: { nodes: { deny: ["suno-generate"], allow: [] } } }
    __resetSurfaceAvailabilityForTests({ nodes: ["generate-video"], models: ["kling"] })
    expect(isNodeUnavailable("generate-video")).toBe(true)
    // The fetched set is the whole answer — a profile deny the server no
    // longer reports (e.g. lifted by an admin override) stops hiding.
    expect(isNodeUnavailable("suno-generate")).toBe(false)
    expect(isModelUnavailable("kling")).toBe(true)
    expect(isModelUnavailable("flux")).toBe(false)
  })

  it("models pre-fetch fallback mirrors nodes", () => {
    window.__NODARO_RUNTIME__ = { surface: { models: { deny: ["kling"], allow: [] } } }
    expect(isModelUnavailable("kling")).toBe(true)
    expect(isModelUnavailable("flux")).toBe(false)
  })
})

describe("surface-availability — a node the admin switch hides from users", () => {
  afterEach(() => vi.unstubAllGlobals())

  /** What the backend sends, per viewer (routes/surface-availability.ts). */
  function stubFetch(body: unknown): void {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })))
  }

  it("never marks anything before the fetch lands", () => {
    expect(isNodeHiddenFromUsers("instagram-scrape")).toBe(false)
  })

  it("an ADMIN's answer: the node is offered (not denied) and marked hidden-from-users", async () => {
    stubFetch({ nodes: { denied: [], hiddenFromUsers: ["instagram-scrape", "meta-ads-scrape"] }, models: { denied: [] } })
    await loadSurfaceAvailability(async () => ({ Authorization: "Bearer t" }), "viewer-1")
    expect(isNodeUnavailable("instagram-scrape")).toBe(false)
    expect(isNodeHiddenFromUsers("instagram-scrape")).toBe(true)
    expect(isNodeHiddenFromUsers("meta-ads-scrape")).toBe(true)
    expect(isNodeHiddenFromUsers("generate-image")).toBe(false)
  })

  it("a USER's answer: the node is denied and nothing is marked", async () => {
    stubFetch({ nodes: { denied: ["instagram-scrape"], hiddenFromUsers: [] }, models: { denied: [] } })
    await loadSurfaceAvailability(async () => ({ Authorization: "Bearer t" }), "viewer-1")
    expect(isNodeUnavailable("instagram-scrape")).toBe(true)
    expect(isNodeHiddenFromUsers("instagram-scrape")).toBe(false)
  })

  it("an older backend that sends no hiddenFromUsers marks nothing", async () => {
    stubFetch({ nodes: { denied: ["instagram-scrape"] }, models: { denied: [] } })
    await loadSurfaceAvailability(async () => ({}), "viewer-1")
    expect(isNodeUnavailable("instagram-scrape")).toBe(true)
    expect(isNodeHiddenFromUsers("instagram-scrape")).toBe(false)
  })
})

describe("surface-availability — one viewer's answer is never shown to the next", () => {
  afterEach(() => vi.unstubAllGlobals())

  const ADMIN_ANSWER = { nodes: { denied: [], hiddenFromUsers: ["instagram-scrape"] }, models: { denied: [] } }
  const USER_ANSWER = { nodes: { denied: ["instagram-scrape"], hiddenFromUsers: [] }, models: { denied: [] } }
  const headers = async () => ({ Authorization: "Bearer t" })
  const answering = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }))

  it("a change of account drops the previous answer even when the new fetch FAILS", async () => {
    vi.stubGlobal("fetch", answering(ADMIN_ANSWER))
    await loadSurfaceAvailability(headers, "admin-1")
    expect(isNodeHiddenFromUsers("instagram-scrape")).toBe(true)

    // The next account's request is refused: nothing new lands.
    vi.stubGlobal("fetch", answering({}, false))
    await loadSurfaceAvailability(headers, "user-1")
    expect(isNodeHiddenFromUsers("instagram-scrape")).toBe(false)
  })

  it("sign-out drops it too", async () => {
    vi.stubGlobal("fetch", answering(ADMIN_ANSWER))
    await loadSurfaceAvailability(headers, "admin-1")
    resetSurfaceAvailability()
    expect(isNodeHiddenFromUsers("instagram-scrape")).toBe(false)
  })

  it("a response that started under the previous account is dropped when it lands", async () => {
    let release: (() => void) | undefined
    const slow = new Promise<void>((resolve) => {
      release = resolve
    })
    // ONE stub answering by call order — the first request (the admin's) hangs,
    // the second (the user's) answers at once. Swapping the stub between the two
    // loads would hand the admin's own request the user's answer, because a load
    // only reaches `fetch` after it has awaited its auth headers.
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        await slow
        return { ok: true, json: async () => ADMIN_ANSWER }
      })
      .mockImplementationOnce(async () => ({ ok: true, json: async () => USER_ANSWER }))
    vi.stubGlobal("fetch", fetchMock)

    const adminLoad = loadSurfaceAvailability(headers, "admin-1")
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    // The account changes while the admin's request is still in flight.
    await loadSurfaceAvailability(headers, "user-1")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    release?.()
    await adminLoad

    expect(isNodeHiddenFromUsers("instagram-scrape")).toBe(false)
    expect(isNodeUnavailable("instagram-scrape")).toBe(true)
  })

  it("the same account asking again does not blank the picker in between", async () => {
    vi.stubGlobal("fetch", answering(ADMIN_ANSWER))
    await loadSurfaceAvailability(headers, "admin-1")
    vi.stubGlobal("fetch", answering({}, false))
    await loadSurfaceAvailability(headers, "admin-1")
    expect(isNodeHiddenFromUsers("instagram-scrape")).toBe(true)
  })
})

describe("surface-availability — Web Scrape sources that follow a withheld node", () => {
  afterEach(() => vi.unstubAllGlobals())
  const answering = (body: unknown) => vi.fn(async () => ({ ok: true, json: async () => body }))
  const headers = async () => ({ Authorization: "Bearer t" })

  it("nothing is withdrawn before the answer lands", () => {
    expect(isWebScrapeSourceUnavailable("instagram")).toBe(false)
    expect(isWebScrapeSourceHiddenFromUsers("instagram")).toBe(false)
  })

  it("a USER's answer withdraws the source; an ADMIN's offers it and marks it", async () => {
    vi.stubGlobal("fetch", answering({ nodes: { denied: ["instagram-scrape"] }, models: { denied: [] }, webScrapeSources: { denied: ["instagram"], hiddenFromUsers: [] } }))
    await loadSurfaceAvailability(headers, "user-1")
    expect(isWebScrapeSourceUnavailable("instagram")).toBe(true)
    expect(isWebScrapeSourceUnavailable("tiktok")).toBe(false)
    expect(isWebScrapeSourceHiddenFromUsers("instagram")).toBe(false)

    vi.stubGlobal("fetch", answering({ nodes: { denied: [], hiddenFromUsers: ["instagram-scrape"] }, models: { denied: [] }, webScrapeSources: { denied: [], hiddenFromUsers: ["instagram"] } }))
    await loadSurfaceAvailability(headers, "admin-1")
    expect(isWebScrapeSourceUnavailable("instagram")).toBe(false)
    expect(isWebScrapeSourceHiddenFromUsers("instagram")).toBe(true)
  })

  it("an older backend that sends no webScrapeSources withdraws nothing", async () => {
    vi.stubGlobal("fetch", answering({ nodes: { denied: ["instagram-scrape"] }, models: { denied: [] } }))
    await loadSurfaceAvailability(headers, "user-1")
    expect(isWebScrapeSourceUnavailable("instagram")).toBe(false)
  })
})

describe("surface-availability — a read that failed, told apart from one still awaited", () => {
  afterEach(() => vi.unstubAllGlobals())

  const ANSWER = { nodes: { denied: ["dubbing"] }, models: { denied: [] } }
  const headers = async () => ({ Authorization: "Bearer t" })
  const answering = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }))

  it("awaited: neither landed nor failed", async () => {
    let release: (() => void) | undefined
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => {
      release = () => resolve({ ok: true, json: async () => ANSWER })
    })))
    const load = loadSurfaceAvailability(headers, "viewer-1")
    await vi.waitFor(() => expect(release).toBeDefined())
    expect(surfaceAvailabilityLoaded()).toBe(false)
    expect(surfaceAvailabilityFailed()).toBe(false)
    release?.()
    await load
    expect(surfaceAvailabilityLoaded()).toBe(true)
    expect(surfaceAvailabilityFailed()).toBe(false)
  })

  it("an error status, the network or a body it cannot read: failed, and readers are told", async () => {
    for (const fetchMock of [
      answering({}, false),
      vi.fn(async () => {
        throw new TypeError("network")
      }),
      vi.fn(async () => ({ ok: true, json: async () => JSON.parse("{") })),
    ]) {
      __resetSurfaceAvailabilityForTests(null)
      vi.stubGlobal("fetch", fetchMock)
      const told = vi.fn()
      const unsubscribe = subscribeSurfaceAvailability(told)
      await loadSurfaceAvailability(headers, "viewer-1")
      unsubscribe()
      expect(surfaceAvailabilityFailed()).toBe(true)
      expect(surfaceAvailabilityLoaded()).toBe(false)
      expect(told).toHaveBeenCalled()
    }
  })

  it("every other reader sees a failed read exactly as an awaited one: the static profile's deny list", async () => {
    window.__NODARO_RUNTIME__ = { surface: { nodes: { deny: ["suno-generate"], allow: [] } } }
    vi.stubGlobal("fetch", answering({}, false))
    await loadSurfaceAvailability(headers, "viewer-1")
    expect(isNodeUnavailable("suno-generate")).toBe(true)
    expect(isNodeUnavailable("dubbing")).toBe(false)
  })

  it("an answer landing afterwards clears it; a later failed re-read keeps the answer", async () => {
    vi.stubGlobal("fetch", answering({}, false))
    await loadSurfaceAvailability(headers, "viewer-1")
    expect(surfaceAvailabilityFailed()).toBe(true)
    vi.stubGlobal("fetch", answering(ANSWER))
    await loadSurfaceAvailability(headers, "viewer-1")
    expect(surfaceAvailabilityFailed()).toBe(false)
    expect(isNodeUnavailable("dubbing")).toBe(true)
    vi.stubGlobal("fetch", answering({}, false))
    await loadSurfaceAvailability(headers, "viewer-1")
    expect(surfaceAvailabilityFailed()).toBe(false)
    expect(surfaceAvailabilityLoaded()).toBe(true)
  })

  it("sign-out and a change of account clear it", async () => {
    vi.stubGlobal("fetch", answering({}, false))
    await loadSurfaceAvailability(headers, "viewer-1")
    resetSurfaceAvailability()
    expect(surfaceAvailabilityFailed()).toBe(false)
    await loadSurfaceAvailability(headers, "viewer-1")
    expect(surfaceAvailabilityFailed()).toBe(true)
    let release: (() => void) | undefined
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => {
      release = () => resolve({ ok: false, json: async () => ({}) })
    })))
    const next = loadSurfaceAvailability(headers, "viewer-2")
    // The next account's read is awaited, not failed.
    expect(surfaceAvailabilityFailed()).toBe(false)
    await vi.waitFor(() => expect(release).toBeDefined())
    release?.()
    await next
    expect(surfaceAvailabilityFailed()).toBe(true)
  })

  it("a read that started under the previous account and fails is not this viewer's", async () => {
    let release: (() => void) | undefined
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ ok: false, json: async () => ({}) })
          }),
      )
      .mockImplementationOnce(() => new Promise(() => {}))
    vi.stubGlobal("fetch", fetchMock)
    const first = loadSurfaceAvailability(headers, "viewer-1")
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    void loadSurfaceAvailability(headers, "viewer-2")
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    release?.()
    await first
    expect(surfaceAvailabilityFailed()).toBe(false)
  })
})
