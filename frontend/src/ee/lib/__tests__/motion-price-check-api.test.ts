// @vitest-environment node
/**
 * The admin Motion price check's client: three POSTs with the auth headers,
 * relative /v1 paths, the `data` envelope unwrapped, and every failure a
 * `MotionPriceApiError` carrying the server's code, message and status.
 * KIE's map rides a runs request only when there is one: no map, no key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer jwt", "X-Nodaro-Workspace": "ws-1" })),
}))

vi.mock("@/lib/api", () => ({ getAuthHeaders: h.getAuthHeaders }))

import {
  MotionPriceApiError,
  fetchKieReal,
  fetchMotionPriceRun,
  fetchMotionPriceRuns,
  type MotionPriceListParams,
} from "../motion-price-check-api"

const RUN_ID = "00000000-0000-4000-8000-000000000001"
const PARAMS: MotionPriceListParams = {
  from: "2026-10-27T22:00:00.000Z",
  to: "2026-11-03T23:00:00.000Z",
  engine: "pulse",
  flaggedOnly: false,
  sort: "margin_usd",
  dir: "asc",
  offset: 0,
  limit: 50,
}
const LIST = { total: 0, runs: [], totals: [], kieApplied: false }

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

let calls: Call[] = []

/** Every fetch answers `payload` with `status`; `json` throws when the body is not JSON. */
function responds(payload: unknown, status = 200, json = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: (init?.headers as Record<string, string>) ?? {},
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      })
      return {
        ok: status < 400,
        status,
        json: async () => {
          if (!json) throw new SyntaxError("Unexpected token < in JSON")
          return payload
        },
      } as Response
    }),
  )
}

beforeEach(() => {
  calls = []
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("fetchMotionPriceRuns", () => {
  it("POSTs the params and KIE's map to the runs route, with the auth headers, and unwraps the list", async () => {
    responds({ data: LIST })
    await expect(fetchMotionPriceRuns(PARAMS, { "task-1": 0.42 })).resolves.toEqual(LIST)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: "/v1/admin/motion-price-check/runs",
      method: "POST",
      headers: { Authorization: "Bearer jwt", "X-Nodaro-Workspace": "ws-1", "Content-Type": "application/json" },
    })
    expect(calls[0]!.body).toStrictEqual({ ...PARAMS, kieUsd: { "task-1": 0.42 } })
  })

  it("sends no kieUsd key when there is no map", async () => {
    responds({ data: LIST })
    await fetchMotionPriceRuns(PARAMS)
    expect(calls[0]!.body).toStrictEqual(PARAMS)
    expect(Object.keys(calls[0]!.body as object)).not.toContain("kieUsd")
  })

  it("throws the server's code, message and status", async () => {
    responds({ error: { code: "x", message: "y" } }, 503)
    const failure = await fetchMotionPriceRuns(PARAMS).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(MotionPriceApiError)
    expect(failure).toMatchObject({ code: "x", message: "y", status: 503 })
  })

  it("names a failure whose body is not the platform's (a proxy's page), with its status", async () => {
    responds(null, 502, false)
    const failure = await fetchMotionPriceRuns(PARAMS).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(MotionPriceApiError)
    expect(failure).toMatchObject({ code: "http_error", status: 502, message: "The request failed (HTTP 502)." })
  })
})

describe("fetchMotionPriceRun", () => {
  it("POSTs KIE's map to the run's route", async () => {
    responds({ data: { run: { id: RUN_ID } } })
    await expect(fetchMotionPriceRun(RUN_ID, { "task-1": 0.42 })).resolves.toEqual({ run: { id: RUN_ID } })
    expect(calls[0]).toMatchObject({ url: `/v1/admin/motion-price-check/runs/${RUN_ID}`, method: "POST" })
    expect(calls[0]!.headers.Authorization).toBe("Bearer jwt")
    expect(calls[0]!.body).toStrictEqual({ kieUsd: { "task-1": 0.42 } })
  })

  it("sends an empty body when there is no map", async () => {
    responds({ data: { run: { id: RUN_ID } } })
    await fetchMotionPriceRun(RUN_ID)
    expect(calls[0]!.body).toStrictEqual({})
  })
})

describe("fetchKieReal", () => {
  it("POSTs the token and the range to the KIE route, and only there", async () => {
    const result = { kieUsd: {}, matched: 0, motionTasks: 0 }
    responds({ data: result })
    const body = { token: "kie-session-token", from: PARAMS.from, to: PARAMS.to }
    await expect(fetchKieReal(body)).resolves.toEqual(result)
    expect(calls[0]).toMatchObject({ url: "/v1/admin/motion-price-check/kie-real", method: "POST" })
    expect(calls[0]!.headers["Content-Type"]).toBe("application/json")
    expect(calls[0]!.body).toStrictEqual(body)
  })

  it("throws a 502 with its message as it comes", async () => {
    responds({ error: { code: "kie_fetch_failed", message: "KIE refused the token: it has expired.", details: { errors: {} } } }, 502)
    await expect(fetchKieReal({ token: "t", from: PARAMS.from, to: PARAMS.to })).rejects.toMatchObject({
      code: "kie_fetch_failed",
      message: "KIE refused the token: it has expired.",
      status: 502,
    })
  })
})
