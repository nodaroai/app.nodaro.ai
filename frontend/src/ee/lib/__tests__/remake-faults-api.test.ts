// @vitest-environment node
/**
 * The admin Remake faults client: one GET with the auth headers, a relative
 * /v1 path, a filter left out sent as no key at all, the `data` envelope
 * unwrapped, and every failure a `RemakeFaultsApiError` carrying the
 * server's code, message and status.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer jwt" })),
}))

vi.mock("@/lib/api", () => ({ getAuthHeaders: h.getAuthHeaders }))

import { RemakeFaultsApiError, fetchRemakeFaults, remakeFaultsQueryOf, type RemakeFaultListParams } from "../remake-faults-api"

const BASE: RemakeFaultListParams = { from: "2026-11-01T00:00:00.000Z", to: "2026-11-08T00:00:00.000Z", offset: 0, limit: 50 }
const LIST = { total: 0, kinds: [], runs: [] }

let calls: { url: string; headers: Record<string, string> }[] = []

function responds(payload: unknown, status = 200, json = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
          if (!json) throw new SyntaxError("Unexpected token <")
          return payload
        },
      }
    }),
  )
}

beforeEach(() => {
  calls = []
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("remakeFaultsQueryOf", () => {
  it("sends the range and the page; a filter left out is no key", () => {
    const q = new URLSearchParams(remakeFaultsQueryOf(BASE))
    expect([...q.keys()].sort()).toEqual(["from", "limit", "offset", "to"])
    expect(q.get("from")).toBe(BASE.from)
    expect(q.get("limit")).toBe("50")
  })

  it("sends each filter given, the kind encoded", () => {
    const q = new URLSearchParams(remakeFaultsQueryOf({ ...BASE, severity: "blocked", kind: "intent override&x", engine: "pulse", offset: 50 }))
    expect(q.get("severity")).toBe("blocked")
    expect(q.get("kind")).toBe("intent override&x")
    expect(q.get("engine")).toBe("pulse")
    expect(q.get("offset")).toBe("50")
  })
})

describe("fetchRemakeFaults", () => {
  it("GETs the relative path with the auth headers and unwraps data", async () => {
    responds({ data: LIST })
    await expect(fetchRemakeFaults(BASE)).resolves.toEqual(LIST)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url.startsWith("/v1/admin/remake-faults?")).toBe(true)
    expect(calls[0]!.headers).toEqual({ Authorization: "Bearer jwt" })
  })

  it("a failure the server answered is its code, sentence and status", async () => {
    responds({ error: { code: "remake_faults_unavailable", message: "Needs the update." } }, 503)
    const err = await fetchRemakeFaults(BASE).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RemakeFaultsApiError)
    expect(err).toMatchObject({ code: "remake_faults_unavailable", message: "Needs the update.", status: 503 })
  })

  it("a body that is not the platform's is named by its status", async () => {
    responds(null, 502, false)
    const err = await fetchRemakeFaults(BASE).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: "http_error", message: "The request failed (HTTP 502).", status: 502 })
  })
})
