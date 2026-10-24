/**
 * `client.trends`: one run by id (`getRun`), a Full Quality version as its
 * own run, and the catalog's tags with their labels (`tags`).
 */
import { describe, expect, expectTypeOf, it, vi } from "vitest"
import {
  createClient,
  NodaroError,
  NotFoundError,
  StaticTokenAuth,
  type TrendChipKey,
  type TrendDetailSlot,
  type TrendRun,
  type TrendTag,
  type TrendRunRequest,
} from "../../index.js"

function mockOk<T>(body: T, status = 200) {
  return Promise.resolve({ ok: true, status, json: async () => body } as unknown as Response)
}

function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
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
  const init = fetchMock.mock.calls[i][1] as { method: string }
  return { url, init }
}

const fullQualityRun: TrendRun = {
  jobId: "job-fq",
  status: "completed",
  progress: 100,
  error: null,
  createdAt: "2026-10-21T10:00:00.000Z",
  completedAt: "2026-10-21T10:05:00.000Z",
  trend: { id: "t-1", slug: "dance-off", version: 3, name: "Dance off" },
  example: 1,
  slots: [],
  preview: false,
  resolution: "1080p",
  draft: false,
  engine: "seedance-2-5",
  videoUrl: "https://cdn.example.com/fq.mp4",
  posterUrl: null,
  creditsCharged: 60,
  fullQualityOf: "job-draft",
  fullQuality: null,
  fullQualityUntil: null,
}

describe("a draft's fullQuality", () => {
  it("is a pointer only: which upgrade exists and its status, never its result", async () => {
    // vitest does not typecheck: this pin is checked by `tsc --noEmit -p packages/client`.
    expectTypeOf<TrendRun["fullQuality"]>().toEqualTypeOf<{ jobId: string; status: string } | null>()

    const draft: TrendRun = {
      ...fullQualityRun,
      jobId: "job-draft",
      resolution: "480p",
      draft: true,
      fullQualityOf: null,
      fullQuality: { jobId: "job-fq", status: "completed" },
      fullQualityUntil: "2026-10-28T10:05:00.000Z",
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: draft }))
    const run = await make(fetchMock).trends.getRun("job-draft")
    expect(run.fullQuality).toEqual({ jobId: "job-fq", status: "completed" })
  })
})

describe("trends.getRun", () => {
  it("GETs /v1/trends/runs/:jobId and returns the run", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: fullQualityRun }))
    const client = make(fetchMock)

    await expect(client.trends.getRun("job-fq")).resolves.toEqual(fullQualityRun)

    const { url, init } = call(fetchMock)
    expect(init.method).toBe("GET")
    expect(url.pathname).toBe("/v1/trends/runs/job-fq")
  })

  it("encodes the job id into the path", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: fullQualityRun }))
    await make(fetchMock).trends.getRun("a/b")
    expect(call(fetchMock).url.pathname).toBe("/v1/trends/runs/a%2Fb")
  })

  it("a run that is not yours (or not a trend run) is a NotFoundError", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(404, { error: { code: "not_found", message: "Run not found" } }))
    await expect(make(fetchMock).trends.getRun("job-x")).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe("trends.tags", () => {
  const tags: TrendTag[] = [
    { tag: "dance", label: "ריקוד", count: 4 },
    { tag: "pets", label: "pets", count: 1 },
  ]

  it("GETs /v1/trends/tags with no query by default and returns the list", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: tags }))
    const client = make(fetchMock)

    await expect(client.trends.tags()).resolves.toEqual(tags)

    const { url, init } = call(fetchMock)
    expect(init.method).toBe("GET")
    expect(url.pathname).toBe("/v1/trends/tags")
    expect([...url.searchParams.keys()]).toEqual([])
  })

  it("sends locale", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [] }))
    await make(fetchMock).trends.tags({ locale: "he" })
    expect(call(fetchMock).url.searchParams.get("locale")).toBe("he")
  })
})

describe("reserved slugs", () => {
  it('refuses "tags" (the tag list) on every slug method before any request, as it does "runs"', async () => {
    const fetchMock = vi.fn()
    const client = make(fetchMock)
    const request: TrendRunRequest = { slots: {} }
    for (const slug of ["tags", "runs"]) {
      for (const attempt of [
        () => client.trends.get(slug),
        () => client.trends.estimate(slug, request),
        () => client.trends.run(slug, request),
        () => client.trends.favorite(slug),
        () => client.trends.unfavorite(slug),
      ]) {
        await expect(attempt()).rejects.toThrow(new RegExp(`"${slug}" is not a trend slug`))
      }
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("chips a trend slot offers", () => {
  it("a slot lists its offered chips as chip keys", () => {
    expectTypeOf<TrendDetailSlot["chips"]>().toEqualTypeOf<TrendChipKey[]>()
    expectTypeOf<TrendChipKey>().toEqualTypeOf<"body" | "outfit" | "hair" | "coat" | "shape" | "finish">()
  })

  it("a chip the slot does not offer is a NodaroError chip_not_offered whose details name the slot and the chip", async () => {
    const body = { error: { code: "chip_not_offered", message: 'Slot "lead" does not offer the "hair" chip: this trend fixes it.', slot: "lead", chip: "hair" } }
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(400, body))
    const err = await make(fetchMock)
      .trends.estimate("dance-off", { slots: { lead: { images: ["https://cdn.example.com/me.png"], hair: "new" } } })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    expect((err as NodaroError).code).toBe("chip_not_offered")
    expect((err as NodaroError).status).toBe(400)
    expect((err as NodaroError).details).toEqual({ slot: "lead", chip: "hair" })
  })
})
