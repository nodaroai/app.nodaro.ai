import { describe, expect, it, vi } from "vitest"
import {
  createClient,
  StaticTokenAuth,
  TrendsResource,
  type TrendCard,
  type TrendDetail,
  type TrendRun,
  type TrendRunRequest,
  type TrendSlotKind,
} from "../../index.js"
import * as trendsEntry from "../../entries/trends.js"

function mockOk<T>(body: T, status = 200) {
  return Promise.resolve({ ok: true, status, json: async () => body } as unknown as Response)
}

function mockNoContent() {
  return Promise.resolve({
    ok: true,
    status: 204,
    json: async () => {
      throw new Error("204 has no body")
    },
  } as unknown as Response)
}

function make(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({
    baseUrl: "https://api.example.com",
    auth: new StaticTokenAuth("t"),
    fetch: fetchMock as unknown as typeof fetch,
  })
}

function call(fetchMock: ReturnType<typeof vi.fn>, i = 0) {
  const url = new URL(fetchMock.mock.calls[i][0] as string)
  const init = fetchMock.mock.calls[i][1] as { method: string; body?: string; headers: Record<string, string> }
  return { url, init }
}

const card: TrendCard = {
  id: "t-1",
  slug: "dance-off",
  name: "Dance off",
  description: "Two people dance",
  tags: ["dance"],
  badges: ["trending"],
  cover: { videoUrl: "https://cdn.example.com/ex1.mp4", posterUrl: "https://cdn.example.com/ex1.jpg", width: 720, height: 1280 },
  needs: { person: 2, location: 1, product: 0, pet: 0 },
  durationSec: 12,
  isFavorite: false,
}

const detail: TrendDetail = {
  ...card,
  version: 3,
  previewSec: 4,
  resolutions: ["480p", "720p", "1080p"],
  slots: [
    { key: "lead", label: "Lead", kind: "person", required: true, hint: "A clear face", defaults: { outfit: "original" } },
    { key: "place", label: "Place", kind: "location", required: false },
  ],
  examples: [
    { videoUrl: "https://cdn.example.com/ex1.mp4", width: 720, height: 1280, slots: { lead: ["https://cdn.example.com/a.png"] } },
  ],
}

const request: TrendRunRequest = {
  slots: {
    lead: { images: ["https://cdn.example.com/me.png"], body: "original", hair: "new" },
    pup: { images: ["https://cdn.example.com/dog.png"], coat: "original" },
  },
  example: 1,
  details: "{slot:lead} waves at the end",
  preview: true,
  resolution: "480p",
  draft: true,
  sessionId: "session-1",
  projectId: "project-1",
}

const run: TrendRun = {
  jobId: "job-1",
  status: "completed",
  progress: 100,
  error: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  completedAt: "2026-10-20T10:03:00.000Z",
  trend: { id: "t-1", slug: "dance-off", version: 3, name: "Dance off" },
  example: 1,
  slots: [
    { key: "lead", label: "Lead", kind: "person", images: ["https://cdn.example.com/me.png"], fromExample: false, body: "original" },
    { key: "place", label: "Place", kind: "location", images: ["https://cdn.example.com/b.png"], fromExample: true },
  ],
  preview: false,
  resolution: "480p",
  draft: true,
  videoUrl: "https://cdn.example.com/out.mp4",
  posterUrl: null,
  creditsCharged: 7,
  fullQuality: null,
  fullQualityUntil: "2026-10-27T10:03:00.000Z",
}

describe("trends resource", () => {
  it("is attached to the client and exported from the root and @nodaro/sdk/trends", () => {
    const client = make(vi.fn())
    expect(client.trends).toBeInstanceOf(TrendsResource)
    expect(trendsEntry.TrendsResource).toBe(TrendsResource)
    const kind: TrendSlotKind = "pet"
    expect(kind).toBe("pet")
  })

  it("list GETs /v1/trends with no query by default and returns the page as sent", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [card], next: "c-2" }))
    const client = make(fetchMock)

    await expect(client.trends.list()).resolves.toEqual({ data: [card], next: "c-2" })

    const { url, init } = call(fetchMock)
    expect(init.method).toBe("GET")
    expect(url.pathname).toBe("/v1/trends")
    expect([...url.searchParams.keys()]).toEqual([])
  })

  it("list sends q, tag, locale, cursor, limit, and favorites: true as favorites=1", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [], next: null }))
    const client = make(fetchMock)

    await client.trends.list({ q: "dance", tag: "pets", favorites: true, locale: "he", cursor: "c-2", limit: 12 })

    const { url } = call(fetchMock)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "dance",
      tag: "pets",
      favorites: "1",
      locale: "he",
      cursor: "c-2",
      limit: "12",
    })
  })

  it("list leaves favorites out when it is false", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [], next: null }))
    const client = make(fetchMock)

    await client.trends.list({ favorites: false })

    expect(call(fetchMock).url.searchParams.has("favorites")).toBe(false)
  })

  it("get GETs /v1/trends/:slug (with locale) and returns the trend", async () => {
    const fetchMock = vi.fn().mockReturnValue(mockOk({ data: detail }))
    const client = make(fetchMock)

    await expect(client.trends.get("dance-off")).resolves.toEqual(detail)
    await client.trends.get("dance-off", { locale: "he" })

    const first = call(fetchMock, 0)
    expect(first.init.method).toBe("GET")
    expect(first.url.pathname).toBe("/v1/trends/dance-off")
    expect([...first.url.searchParams.keys()]).toEqual([])
    expect(Object.fromEntries(call(fetchMock, 1).url.searchParams)).toEqual({ locale: "he" })
  })

  it("encodes the slug into the path", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: detail }))
    const client = make(fetchMock)

    await client.trends.get("a/b")

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/trends/a%2Fb")
  })

  it("estimate POSTs the request to /v1/trends/:slug/estimate and returns the quote", async () => {
    const quote = { expectedCredits: 30, holdCredits: 45, breakdown: { castSwap: 20, seedance: 25 } }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: quote }))
    const client = make(fetchMock)

    await expect(client.trends.estimate("dance-off", request)).resolves.toEqual(quote)

    const { url, init } = call(fetchMock)
    expect(init.method).toBe("POST")
    expect(url.pathname).toBe("/v1/trends/dance-off/estimate")
    expect(JSON.parse(init.body as string)).toEqual(request)
  })

  it("estimate and run send previewJobId, and the quote carries maskingCredits", async () => {
    const quote = { expectedCredits: 30, holdCredits: 45, breakdown: { castSwap: 20, seedance: 25, masking: 12 }, maskingCredits: 12 }
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ data: quote }))
      .mockReturnValueOnce(mockOk({ data: { jobId: "job-2" } }, 202))
    const client = make(fetchMock)
    const withPreview: TrendRunRequest = { ...request, previewJobId: "0b7d4b8e-3f1e-4c55-9d1a-6f2c1e9a7b10" }

    const got = await client.trends.estimate("dance-off", withPreview)
    expect(got.maskingCredits).toBe(12)
    await client.trends.run("dance-off", withPreview)

    for (const [, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(JSON.parse(init.body as string).previewJobId).toBe("0b7d4b8e-3f1e-4c55-9d1a-6f2c1e9a7b10")
    }
  })

  it("run POSTs the request to /v1/trends/:slug/runs and returns the job id", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { jobId: "job-1" } }, 202))
    const client = make(fetchMock)

    await expect(client.trends.run("dance-off", request)).resolves.toEqual({ jobId: "job-1" })

    const { url, init } = call(fetchMock)
    expect(init.method).toBe("POST")
    expect(url.pathname).toBe("/v1/trends/dance-off/runs")
    expect(JSON.parse(init.body as string)).toEqual(request)
    expect(Object.keys(init.headers).map((k) => k.toLowerCase())).not.toContain("idempotency-key")
  })

  it("run sends idempotencyKey as the Idempotency-Key header (an empty one sends none)", async () => {
    const fetchMock = vi.fn().mockReturnValue(mockOk({ data: { jobId: "job-1" } }, 202))
    const client = make(fetchMock)

    await client.trends.run("dance-off", request, { idempotencyKey: "retry-key-0001" })
    await client.trends.run("dance-off", request, { idempotencyKey: "" })

    expect(call(fetchMock, 0).init.headers["Idempotency-Key"]).toBe("retry-key-0001")
    expect(Object.keys(call(fetchMock, 1).init.headers).map((k) => k.toLowerCase())).not.toContain("idempotency-key")
  })

  it("runs GETs /v1/trends/runs with trend, cursor and limit and returns the page as sent", async () => {
    const fetchMock = vi.fn().mockReturnValue(mockOk({ data: [run], next: null }))
    const client = make(fetchMock)

    await expect(client.trends.runs()).resolves.toEqual({ data: [run], next: null })
    await client.trends.runs({ trend: "dance-off", cursor: "c-2", limit: 5 })

    const first = call(fetchMock, 0)
    expect(first.init.method).toBe("GET")
    expect(first.url.pathname).toBe("/v1/trends/runs")
    expect([...first.url.searchParams.keys()]).toEqual([])
    expect(Object.fromEntries(call(fetchMock, 1).url.searchParams)).toEqual({ trend: "dance-off", cursor: "c-2", limit: "5" })
  })

  it("favorite PUTs and unfavorite DELETEs /v1/trends/:slug/favorite (204, nothing returned)", async () => {
    const fetchMock = vi.fn().mockImplementation(() => mockNoContent())
    const client = make(fetchMock)

    await expect(client.trends.favorite("dance-off")).resolves.toBeUndefined()
    await expect(client.trends.unfavorite("dance-off")).resolves.toBeUndefined()

    expect(call(fetchMock, 0).init.method).toBe("PUT")
    expect(call(fetchMock, 0).url.pathname).toBe("/v1/trends/dance-off/favorite")
    expect(call(fetchMock, 1).init.method).toBe("DELETE")
    expect(call(fetchMock, 1).url.pathname).toBe("/v1/trends/dance-off/favorite")
  })

  it('refuses the reserved slug "runs" on every slug method before any request', async () => {
    const fetchMock = vi.fn()
    const client = make(fetchMock)
    const request: TrendRunRequest = { slots: {} }
    for (const attempt of [
      () => client.trends.get("runs"),
      () => client.trends.estimate("runs", request),
      () => client.trends.run("runs", request),
      () => client.trends.favorite("runs"),
      () => client.trends.unfavorite("runs"),
    ]) {
      await expect(attempt()).rejects.toThrow(/"runs" is not a trend slug/)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
