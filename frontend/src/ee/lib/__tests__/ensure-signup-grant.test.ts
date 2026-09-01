import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The claim runs on boot, before anything the user asked for. So every test
 * here is really the same assertion from a different angle: the request goes
 * out, once, and nothing that happens on the way can stop the page from
 * rendering. A fingerprint is a signal, never a precondition — a browser that
 * refuses to be fingerprinted still gets its credits, and the absence is
 * itself what the server scores.
 */

const h = vi.hoisted(() => ({
  getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer jwt", "X-Nodaro-Workspace": "ws-1" })),
  computeDeviceKey: vi.fn(async (): Promise<string | null> => "d".repeat(64)),
  sha256Hex: vi.fn(async (value: string): Promise<string | null> =>
    value === "visitor-1" ? "b".repeat(64) : null,
  ),
  load: vi.fn(async (_options?: { monitoring?: boolean }) => ({
    get: async () => ({ visitorId: "visitor-1" }),
  })),
}))

vi.mock("@/lib/api", () => ({ getAuthHeaders: h.getAuthHeaders }))
vi.mock("../device-key", () => ({ computeDeviceKey: h.computeDeviceKey, sha256Hex: h.sha256Hex }))
vi.mock("@fingerprintjs/fingerprintjs", () => ({ load: h.load }))

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

let calls: Call[] = []

function captureFetch(response: { ok?: boolean; status?: number } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: (init?.headers as Record<string, string>) ?? {},
        body: init?.body ? JSON.parse(init.body as string) : {},
      })
      return { ok: response.ok ?? true, status: response.status ?? 200, json: async () => ({}) } as Response
    }),
  )
}

/** The module holds a once-per-page-load latch, so each test needs a fresh one. */
async function loadSubject() {
  vi.resetModules()
  const mod = await import("../ensure-signup-grant")
  return mod.ensureSignupGrant
}

beforeEach(() => {
  calls = []
  captureFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("the claim request", () => {
  it("carries both keys when the fingerprint resolves", async () => {
    const ensureSignupGrant = await loadSubject()
    await ensureSignupGrant()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("/v1/credits/claim-signup-grant")
    expect(calls[0].method).toBe("POST")
    expect(calls[0].body).toEqual({ browserKey: "b".repeat(64), deviceKey: "d".repeat(64) })
  })

  it("is session-bound and sent as JSON", async () => {
    const ensureSignupGrant = await loadSubject()
    await ensureSignupGrant()
    expect(calls[0].headers.Authorization).toBe("Bearer jwt")
    expect(calls[0].headers["Content-Type"]).toBe("application/json")
  })

  it("never lets the fingerprint library phone home", async () => {
    const ensureSignupGrant = await loadSubject()
    await ensureSignupGrant()
    // FingerprintJS beacons an install-stats ping unless monitoring is off,
    // and no CSP at our edge would catch it. This assertion is the only guard.
    expect(h.load).toHaveBeenCalledWith({ monitoring: false })
  })
})

describe("a fingerprint that does not come back", () => {
  it("still claims when the browser key fails", async () => {
    h.load.mockRejectedValueOnce(new Error("no canvas here"))
    const ensureSignupGrant = await loadSubject()
    await ensureSignupGrant()
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ deviceKey: "d".repeat(64) })
  })

  it("still claims when the device key cannot be computed", async () => {
    h.computeDeviceKey.mockResolvedValueOnce(null)
    const ensureSignupGrant = await loadSubject()
    await ensureSignupGrant()
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ browserKey: "b".repeat(64) })
  })

  it("claims with no keys at all rather than waiting on one that never resolves", async () => {
    h.load.mockImplementationOnce(() => new Promise(() => {}))
    h.computeDeviceKey.mockImplementationOnce(() => new Promise(() => {}))
    const ensureSignupGrant = await loadSubject()
    await ensureSignupGrant({ fingerprintTimeoutMs: 5 })
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({})
  })

  it("posts the key that did finish when the other one hangs", async () => {
    h.load.mockImplementationOnce(() => new Promise(() => {}))
    const ensureSignupGrant = await loadSubject()
    await ensureSignupGrant({ fingerprintTimeoutMs: 5 })
    expect(calls[0].body).toEqual({ deviceKey: "d".repeat(64) })
  })
})

describe("failures the page must never see", () => {
  it("swallows a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    const ensureSignupGrant = await loadSubject()
    await expect(ensureSignupGrant()).resolves.toBeUndefined()
  })

  it("swallows a server error", async () => {
    captureFetch({ ok: false, status: 500 })
    const ensureSignupGrant = await loadSubject()
    await expect(ensureSignupGrant()).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
  })

  it("swallows a broken auth header lookup", async () => {
    h.getAuthHeaders.mockRejectedValueOnce(new Error("no session"))
    const ensureSignupGrant = await loadSubject()
    await expect(ensureSignupGrant()).resolves.toBeUndefined()
  })
})

describe("once per page load", () => {
  it("ignores a second call, including one racing the first", async () => {
    const ensureSignupGrant = await loadSubject()
    // loadRoleAndTier runs from the initial load AND from the INITIAL_SESSION
    // event in the same tick — the latch has to hold before the first await.
    const first = ensureSignupGrant()
    await ensureSignupGrant()
    await first
    await ensureSignupGrant()
    expect(calls).toHaveLength(1)
    expect(h.load).toHaveBeenCalledTimes(1)
  })
})
