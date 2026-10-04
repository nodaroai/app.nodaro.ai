import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import type { TrackedCompetitor } from "../../index.js"

function mockOk<T>(body: T, status = 200) {
  return Promise.resolve({ ok: true, status, json: async () => body } as unknown as Response)
}

function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
}

function call(fetchMock: ReturnType<typeof vi.fn>, n = 0) {
  const [url, init] = fetchMock.mock.calls[n] as [string, { method: string; body?: string }]
  return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined }
}

const ID = "00000000-0000-4000-8000-0000000000c1"
const COMPETITOR = { id: ID, brand: "Acme Paint", searches: 2 } as unknown as TrackedCompetitor

describe("competitors resource", () => {
  it("lists, reads, adds, changes and removes tracked brands", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ data: [COMPETITOR] }))
      .mockReturnValueOnce(mockOk({ ...COMPETITOR, latestScan: null, scans: [] }))
      .mockReturnValueOnce(mockOk(COMPETITOR, 201))
      .mockReturnValueOnce(mockOk(COMPETITOR))
      .mockReturnValueOnce(mockOk({ success: true }))
    const sdk = client(fetchMock)

    expect(await sdk.competitors.list()).toEqual([COMPETITOR])
    expect((await sdk.competitors.get(ID)).latestScan).toBeNull()
    await sdk.competitors.create({ brand: "Acme Paint", accounts: { tiktok: "acmepaint" } })
    await sdk.competitors.update(ID, { schedule: "daily" })
    await expect(sdk.competitors.delete(ID)).resolves.toBeUndefined()

    expect(call(fetchMock, 0)).toMatchObject({ url: "https://api.example.com/v1/competitors", method: "GET" })
    expect(call(fetchMock, 1)).toMatchObject({ url: `https://api.example.com/v1/competitors/${ID}`, method: "GET" })
    expect(call(fetchMock, 2)).toMatchObject({ method: "POST", body: { brand: "Acme Paint", accounts: { tiktok: "acmepaint" } } })
    expect(call(fetchMock, 3)).toMatchObject({ url: `https://api.example.com/v1/competitors/${ID}`, method: "PATCH", body: { schedule: "daily" } })
    expect(call(fetchMock, 4)).toMatchObject({ method: "DELETE" })
  })

  it("reads the cards, looks a website up, and starts a scan", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ cards: [], posts: {} }))
      .mockReturnValueOnce(mockOk({ brand: "Acme Paint", website: "https://acme.example/", accounts: {} }))
      .mockReturnValueOnce(mockOk({ jobId: "job-1" }))
    const sdk = client(fetchMock)

    expect(await sdk.competitors.cards()).toEqual({ cards: [], posts: {} })
    expect((await sdk.competitors.discover("acme.example")).brand).toBe("Acme Paint")
    expect(await sdk.competitors.scan(ID)).toEqual({ jobId: "job-1" })

    expect(call(fetchMock, 0).url).toBe("https://api.example.com/v1/competitors/cards")
    expect(call(fetchMock, 1)).toMatchObject({ url: "https://api.example.com/v1/competitor-discover", body: { website: "acme.example" } })
    expect(call(fetchMock, 2)).toMatchObject({ url: "https://api.example.com/v1/competitor-scan", body: { competitorId: ID } })
  })

  it("reads what works for a brand", async () => {
    const result = { lessons: { subjectId: ID, isOwn: true, platforms: [], minPosts: 6 }, posts: {} }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(result))
    const sdk = client(fetchMock)
    expect(await sdk.competitors.lessons(ID)).toEqual(result)
    expect(call(fetchMock, 0)).toMatchObject({ url: `https://api.example.com/v1/competitors/${ID}/lessons`, method: "GET" })
  })
})

describe("did it work", () => {
  it("lists the cards you tried, marks one done with its post, links, sees and undoes", async () => {
    const MARK = "00000000-0000-4000-8000-0000000000a1"
    const result = { action: { id: MARK, outcome: { state: "no_posts_yet" } }, posts: {}, created: true }
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ actions: [], record: [], posts: {} }))
      .mockReturnValueOnce(mockOk(result, 201))
      .mockReturnValueOnce(mockOk(result))
      .mockReturnValueOnce(mockOk(result))
      .mockReturnValueOnce(mockOk(result))
      .mockReturnValueOnce(mockOk({ success: true }))
    const sdk = client(fetchMock)

    expect(await sdk.competitors.tried()).toEqual({ actions: [], record: [], posts: {} })
    expect((await sdk.competitors.markDone("sound:c1:7", { postUrl: "https://www.tiktok.com/@me/video/1" })).created).toBe(true)
    await sdk.competitors.linkPost(MARK, "https://www.tiktok.com/@me/video/2")
    await sdk.competitors.linkPost(MARK, null)
    await sdk.competitors.markSeen(MARK)
    await expect(sdk.competitors.unmark(MARK)).resolves.toBeUndefined()

    expect(call(fetchMock, 0)).toMatchObject({ url: "https://api.example.com/v1/competitors/actions", method: "GET" })
    expect(call(fetchMock, 1)).toMatchObject({ method: "POST", body: { cardId: "sound:c1:7", postUrl: "https://www.tiktok.com/@me/video/1" } })
    expect(call(fetchMock, 2)).toMatchObject({ url: `https://api.example.com/v1/competitors/actions/${MARK}`, method: "PATCH", body: { postUrl: "https://www.tiktok.com/@me/video/2" } })
    expect(call(fetchMock, 3).body).toEqual({ postUrl: null })
    expect(call(fetchMock, 4).body).toEqual({ seen: true })
    expect(call(fetchMock, 5)).toMatchObject({ url: `https://api.example.com/v1/competitors/actions/${MARK}`, method: "DELETE" })
  })
})
